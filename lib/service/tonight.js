import * as Astronomy from 'astronomy-engine';
import loggers from 'namespaced-console-logger';
import sunMoonService, { validateQuery, localDay, formatInZone } from './sunmoon.js';
import cloudsService from './clouds.js';
import issService from './iss.js';
import planetsService from './planets.js';
import starsService from './stars.js';
import { SourceUnavailableError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:tonight');

const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;
// Sun altitude at each stage of dusk. The viewing window opens at civil dusk, when the Moon,
// bright planets and the ISS are visible; faint objects need nautical or astronomical darkness.
const DUSK_ALTITUDES = { civil: -6, nautical: -12, astronomical: -18 };

const roundToMinute = (date) => new Date(Math.round(date.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);

// Cloud cover (%) is "steady" over the window when it varies by at most this many points,
// or when every hour falls in the same sky band
const STEADY_SPREAD = 10;

// Sky band for a cloud cover percentage
function skyBand(cover) {
  if (cover < 20) return 'clear';
  if (cover < 50) return 'partly_cloudy';
  if (cover < 80) return 'mostly_cloudy';
  return 'cloudy';
}

function nextDate({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

class TonightService {
  /**
   * Stargazing conditions for the evening of the local date `date` in `tz`.
   *
   * status "na": there is no evening viewing window (e.g. midnight sun, polar night), so every
   * window-based section is null and `reason` says why.
   * status "ok": sections that cannot be filled are null, with the reason under
   * `unavailable.<section>`, so one failing data source does not fail the whole response.
   */
  async getTonight(params = {}) {
    const q = validateQuery(params);
    const { lat, lon, date, tz } = q;
    logger.info(`Computing tonight for ${JSON.stringify({ lat, lon, date, tz })}`);

    const { query, sun, moon } = sunMoonService.getSunMoon({ lat, lon, date, tz });

    const window = this.#viewingWindow(q, sun);
    if (window.reason) {
      return { query, status: 'na', reason: window.reason, window: null, sun, moon, clouds: null, objects: null, unavailable: {} };
    }

    // Each data source fills its part independently; a failed one is reported under `unavailable`
    const unavailable = {};
    const settle = async (key, promise) => {
      try {
        return await promise;
      } catch (error) {
        if (!(error instanceof SourceUnavailableError)) throw error;
        unavailable[key] = error.message;
        return null;
      }
    };

    const [clouds, iss] = await Promise.all([
      settle('clouds', this.#clouds(q, window)),
      settle('objects.iss', this.#iss(q, window)),
    ]);

    // Objects expected to be viewable in the window; an object with nothing to see is left out
    const objects = [iss, ...this.#planets(q, window), ...this.#stars(q, window)].filter(Boolean);

    const fmt = (d) => formatInZone(d, tz);
    return {
      query,
      status: 'ok',
      window: {
        start: fmt(window.start),
        end: fmt(window.end),
        darkness: { nautical: fmt(window.darkness.nautical), astronomical: fmt(window.darkness.astronomical) },
        darkest: window.darkest,
      },
      sun,
      moon,
      clouds,
      objects,
      unavailable,
    };
  }

  async #iss(q, window) {
    const passes = await issService.getVisiblePasses({ lat: q.lat, lon: q.lon, start: window.start, end: window.end });
    if (passes.length === 0) return null;

    const point = (p) => ({ ...p, time: formatInZone(p.time, q.tz) });
    return {
      id: 'iss',
      name: 'International Space Station',
      kind: 'satellite',
      passes: passes.map(p => ({ ...p, start: point(p.start), peak: point(p.peak), end: point(p.end) })),
    };
  }

  // Computed locally, so there is no data source to fail
  #planets(q, window) {
    const point = (p) => ({ ...p, time: formatInZone(p.time, q.tz) });
    return planetsService.getVisiblePlanets({ lat: q.lat, lon: q.lon, start: window.start, end: window.end })
      .map(({ id, name, start, peak, end, magnitude, constellation }) => ({
        id,
        name,
        kind: 'planet',
        start: point(start),
        peak: point(peak),
        end: point(end),
        magnitude,
        constellation,
      }));
  }

  // Stars show from nautical darkness, so they are only looked for from then; a window that
  // never gets that dark has none. Computed locally, so there is no data source to fail.
  #stars(q, window) {
    if (!window.darkness.nautical) return [];
    const point = (p) => ({ ...p, time: formatInZone(p.time, q.tz) });
    return starsService.getVisibleStars({ lat: q.lat, lon: q.lon, start: window.darkness.nautical, end: window.end })
      .map(({ id, name, start, peak, end, magnitude, constellation }) => ({
        id,
        name,
        kind: 'star',
        start: point(start),
        peak: point(peak),
        end: point(end),
        magnitude,
        constellation,
      }));
  }

  // Civil dusk until local midnight, with the times the sky gets darker within it
  #viewingWindow(q, sun) {
    if (!sun.set) {
      if (sun.polar === 'always_up') return { reason: 'The sun does not set on this date.' };
      if (sun.polar === 'always_down') return { reason: 'The sun does not rise or set on this date.' };
      return { reason: 'No sunset on this date.' };
    }
    const { end, noon } = localDay(q);
    const observer = new Astronomy.Observer(q.lat, q.lon, 0);

    // Searched forward from solar noon: a crossing in the small hours of this date (or a sunset
    // just after midnight) belongs to the previous night
    const from = sun.transit ? new Date(sun.transit) : noon;
    const dusk = (altitude) => {
      const t = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, from, (end - from) / MS_PER_DAY, altitude);
      return t && t.date < end ? roundToMinute(t.date) : null;
    };

    const start = dusk(DUSK_ALTITUDES.civil);
    if (!start) return { reason: 'It does not get dark before midnight.' };
    const nautical = dusk(DUSK_ALTITUDES.nautical);
    const astronomical = nautical && dusk(DUSK_ALTITUDES.astronomical);
    const darkest = astronomical ? 'astronomical' : nautical ? 'nautical' : 'civil';
    return { start, end, darkness: { nautical, astronomical }, darkest };
  }

  async #clouds(q, window) {
    const samples = await cloudsService.getHourlyClouds({
      lat: q.lat,
      lon: q.lon,
      tz: q.tz,
      startDate: q.date,
      endDate: nextDate(q), // midnight sample is on the next date
    });

    // Hourly samples within the window, plus the last one at or before its start so the
    // opening of the window is covered when it does not fall on the hour
    const lastBefore = samples.findLast(s => s.time <= window.start);
    const hourly = samples.filter(s => (s.time > window.start && s.time <= window.end) || s === lastBefore);
    if (hourly.length === 0) throw new SourceUnavailableError('No cloud forecast samples for the viewing window.');

    const covers = hourly.map(s => s.cover);
    const meanCover = Math.round(covers.reduce((a, b) => a + b, 0) / covers.length);
    const minCover = Math.min(...covers);
    const maxCover = Math.max(...covers);
    const fmt = (d) => formatInZone(d, q.tz);

    // When cover barely changes, no hour is meaningfully clearer than the others
    const steady = maxCover - minCover <= STEADY_SPREAD || new Set(covers.map(skyBand)).size === 1;
    let clearest = null;
    if (!steady) {
      const best = hourly.reduce((b, s) => (s.cover < b.cover ? s : b));
      // The lead-in sample can be before the window opens; report the opening instead
      const time = best.time < window.start ? window.start : best.time;
      clearest = { time: fmt(time), cover: best.cover };
    }

    return {
      source: 'open-meteo',
      summary: {
        sky: skyBand(meanCover),
        steady,
        meanCover,
        minCover,
        maxCover,
        clearest,
      },
      hourly: hourly.map(s => ({ ...s, time: fmt(s.time) })),
    };
  }
}

export default new TonightService();
