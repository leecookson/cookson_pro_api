import loggers from 'namespaced-console-logger';
import sunMoonService, { validateQuery, localDay, formatInZone } from './sunmoon.js';
import cloudsService from './clouds.js';
import issService from './iss.js';
import { SourceUnavailableError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:tonight');

const MS_PER_HOUR = 3600000;
// Viewing window opens this long after sunset, once the sky is reasonably dark
const WINDOW_START_AFTER_SUNSET_MS = MS_PER_HOUR;

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
    const objects = [iss].filter(Boolean);

    const fmt = (d) => formatInZone(d, tz);
    return {
      query,
      status: 'ok',
      window: { start: fmt(window.start), end: fmt(window.end) },
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

  // Sunset + 1 hour until local midnight
  #viewingWindow(q, sun) {
    if (!sun.set) {
      if (sun.polar === 'always_up') return { reason: 'The sun does not set on this date.' };
      if (sun.polar === 'always_down') return { reason: 'The sun does not rise or set on this date.' };
      return { reason: 'No sunset on this date.' };
    }
    const start = new Date(new Date(sun.set).getTime() + WINDOW_START_AFTER_SUNSET_MS);
    const { end } = localDay(q);
    if (start >= end) return { reason: 'Sunset plus one hour is after midnight.' };
    return { start, end };
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
