import * as Astronomy from 'astronomy-engine';
import * as satellite from 'satellite.js';
import loggers from 'namespaced-console-logger';
import { SourceUnavailableError } from '../common/errors.js';
import { cached } from '../common/cache.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:iss');

const ISS_NORAD_ID = 25544;

// Tried in order. CelesTrak is authoritative but asks clients not to fetch the same data more
// than every 2 hours; the others mirror the same element sets.
const TLE_SOURCES = [
  { name: 'celestrak', url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_NORAD_ID}&FORMAT=TLE`, parse: parseTleText },
  { name: 'ariss', url: 'https://live.ariss.org/iss.txt', parse: parseTleText },
  { name: 'tle-api', url: `https://tle.ivanstanojevic.me/api/tle/${ISS_NORAD_ID}`, parse: (body) => JSON.parse(body) },
];
// Shared across Lambda containers, so the sources are fetched at most about every 6 hours.
// A stale element set is still usable (predictions are limited by MAX_DAYS_FROM_EPOCH anyway).
const TLE_CACHE_KEY = `tle:${ISS_NORAD_ID}`;
const TLE_FRESH_MS = 6 * 3600000;
const TLE_MAX_STALE_MS = 3 * 86400000;
// Per source; a slow source must not hold up the whole response
const TIMEOUT_MS = 4000;

// SGP4 pass times drift as predictions move away from the element set's epoch (and the ISS reboosts
// unpredictably); within a few days they are typically good to about a minute
const MAX_DAYS_FROM_EPOCH = 5;

// Conventional naked-eye visibility: the ISS is high enough, the observer's sky is dark
// enough, and the ISS itself is still in sunlight
const MIN_ELEVATION_DEG = 10;
const MAX_SUN_ALTITUDE_DEG = -6;
const STEP_MS = 10000;

function parseTleText(body) {
  const lines = body.split(/\r?\n/).map(l => l.trim());
  const line1 = lines.find(l => l.startsWith('1 '));
  const line2 = lines.find(l => l.startsWith('2 '));
  return { line1, line2 };
}

// TLE epoch (line 1 columns 19-32): two-digit year, then fractional day of year
function tleEpoch(line1) {
  const yy = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000);
}

const round = (value) => Math.round(value * 10) / 10;

class IssService {
  async #fetchTle() {
    for (const source of TLE_SOURCES) {
      try {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { line1, line2 } = source.parse(await response.text());
        if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) throw new Error('No TLE in response');
        logger.info(`Fetched ISS TLE from ${source.name}`);
        return { line1, line2 };
      } catch (error) {
        logger.warn(`ISS TLE source ${source.name} failed: ${error.message}`);
      }
    }
    throw new SourceUnavailableError('ISS orbit data could not be retrieved.');
  }

  async #getTle() {
    const { line1, line2 } = await cached(TLE_CACHE_KEY, { freshMs: TLE_FRESH_MS, maxStaleMs: TLE_MAX_STALE_MS }, () => this.#fetchTle());
    return { line1, line2, epoch: tleEpoch(line1) };
  }

  /**
   * Visible ISS passes between `start` and `end` (Dates) for an observer at lat/lon.
   * Returns [{ start, peak, end, durationSeconds, endsInShadow }], where start/peak/end are
   * { time: Date, altitude, azimuth } in degrees. Passes are clipped to [start, end].
   */
  async getVisiblePasses({ lat, lon, start, end }) {
    const tle = await this.#getTle();
    const daysFromEpoch = Math.max(Math.abs(start - tle.epoch), Math.abs(end - tle.epoch)) / 86400000;
    if (daysFromEpoch > MAX_DAYS_FROM_EPOCH) {
      throw new SourceUnavailableError('ISS pass predictions are only available for a few days around today.');
    }

    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const observerGd = { latitude: satellite.degreesToRadians(lat), longitude: satellite.degreesToRadians(lon), height: 0 };
    const observer = new Astronomy.Observer(lat, lon, 0);

    const passes = [];
    let current = null;
    let lastSample = null;

    for (let t = start.getTime(); t <= end.getTime(); t += STEP_MS) {
      const sample = this.#sample(satrec, observerGd, observer, new Date(t));
      if (sample?.visible) {
        if (!current) current = { start: sample, peak: sample };
        if (sample.altitude > current.peak.altitude) current.peak = sample;
        lastSample = sample;
      } else if (current) {
        passes.push(toPass(current, lastSample, sample?.inShadow ?? false));
        current = null;
      }
    }
    if (current) passes.push(toPass(current, lastSample, false));

    return passes;
  }

  #sample(satrec, observerGd, observer, time) {
    const pv = satellite.propagate(satrec, time);
    if (!pv?.position) return null;

    const ecf = satellite.eciToEcf(pv.position, satellite.gstime(time));
    const look = satellite.ecfToLookAngles(observerGd, ecf);
    const altitude = satellite.radiansToDegrees(look.elevation);
    const azimuth = satellite.radiansToDegrees(look.azimuth);
    if (altitude < MIN_ELEVATION_DEG) return { visible: false };

    // Only compute sun geometry while the ISS is above the threshold
    const sunEq = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
    const sunAltitude = Astronomy.Horizon(time, observer, sunEq.ra, sunEq.dec, 'normal').altitude;
    const inShadow = satellite.shadowFraction(satellite.sunPos(satellite.jday(time)).rsun, pv.position) >= 1;

    return {
      visible: sunAltitude <= MAX_SUN_ALTITUDE_DEG && !inShadow,
      inShadow,
      time,
      altitude,
      azimuth,
    };
  }
}

function toPass({ start, peak }, end, endsInShadow) {
  const point = (s) => ({ time: s.time, altitude: round(s.altitude), azimuth: round(s.azimuth) });
  return {
    start: point(start),
    peak: point(peak),
    end: point(end),
    durationSeconds: Math.round((end.time - start.time) / 1000),
    endsInShadow,
  };
}

export default new IssService();
