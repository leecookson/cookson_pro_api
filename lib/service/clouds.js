import loggers from 'namespaced-console-logger';
import { SourceUnavailableError } from '../common/errors.js';
import { cached } from '../common/cache.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:clouds');

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURLY_FIELDS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility'];
const TIMEOUT_MS = 10000;

// Open-Meteo updates its models about hourly; a forecast a few hours old is still useful
// if the provider is down
const FRESH_MS = 3600000;
const MAX_STALE_MS = 6 * 3600000;

class CloudsService {
  /**
   * Hourly cloud cover samples from Open-Meteo for the local dates `startDate`..`endDate` (YYYY-MM-DD in `tz`).
   * Returns [{ time: Date, cover, low, mid, high, visibilityMeters }], cover values in percent.
   */
  async getHourlyClouds({ lat, lon, tz, startDate, endDate }) {
    // ~1 km is far finer than the forecast grid, and lets nearby requests share a cache entry
    const latitude = lat.toFixed(2);
    const longitude = lon.toFixed(2);
    const key = `clouds:${latitude}:${longitude}:${tz}:${startDate}:${endDate}`;

    const hourly = await cached(key, { freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS },
      () => this.#fetchHourly({ latitude, longitude, tz, startDate, endDate }));

    return hourly.time.map((t, i) => ({
      time: new Date(t * 1000),
      cover: hourly.cloud_cover[i],
      low: hourly.cloud_cover_low[i],
      mid: hourly.cloud_cover_mid[i],
      high: hourly.cloud_cover_high[i],
      visibilityMeters: hourly.visibility[i],
    }));
  }

  // Open-Meteo `hourly` object: arrays keyed by field, with unix-seconds `time`
  async #fetchHourly({ latitude, longitude, tz, startDate, endDate }) {
    const params = new URLSearchParams({
      latitude,
      longitude,
      hourly: HOURLY_FIELDS.join(','),
      timezone: tz,
      timeformat: 'unixtime',
      start_date: startDate,
      end_date: endDate,
    });
    const url = `${API_URL}?${params}`;
    logger.info(`Calling external API: ${url}`);

    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      logger.error(`Error calling Open-Meteo: ${error.message}`);
      throw new SourceUnavailableError('Cloud forecast provider could not be reached.');
    }

    if (!response.ok) {
      // Open-Meteo returns 400 with { error: true, reason } e.g. for dates outside the forecast range
      const body = await response.json().catch(() => ({}));
      logger.warn(`Open-Meteo error: ${response.status} ${body.reason || response.statusText}`);
      if (/out of allowed range/.test(body.reason)) {
        throw new SourceUnavailableError('Cloud forecast is not available for this date.');
      }
      throw new SourceUnavailableError(`Cloud forecast provider returned ${response.status}.`);
    }

    const { hourly } = await response.json();
    return hourly;
  }
}

export default new CloudsService();
