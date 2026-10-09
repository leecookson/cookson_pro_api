import loggers from 'namespaced-console-logger';
import { SourceUnavailableError, ValidationError } from '../common/errors.js';
import { cached } from '../common/cache.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:airquality');

const API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = 10000;

// Open-Meteo updates hourly; 30 minutes keeps us within an hour of the latest value.
// Serve older values for a while if the provider is down.
const FRESH_MS = 30 * 60000;
const MAX_STALE_MS = 3 * 3600000;

// Our pollutant keys, in tie-break order for `dominant`, mapped to Open-Meteo field names
const POLLUTANTS = {
  pm2_5: 'pm2_5',
  pm10: 'pm10',
  ozone: 'ozone',
  no2: 'nitrogen_dioxide',
  so2: 'sulphur_dioxide',
  co: 'carbon_monoxide',
};

// The European AQI has no carbon monoxide sub-index
const EU_POLLUTANTS = ['pm2_5', 'pm10', 'ozone', 'no2', 'so2'];

const CURRENT_FIELDS = [
  'us_aqi',
  'european_aqi',
  'uv_index',
  ...Object.values(POLLUTANTS),
  ...Object.values(POLLUTANTS).map(f => `us_aqi_${f}`),
  ...EU_POLLUTANTS.map(k => `european_aqi_${POLLUTANTS[k]}`),
];

// Upper bound (inclusive) of each band; anything above the last is the final category
const US_BANDS = [[50, 'good'], [100, 'moderate'], [150, 'unhealthy_sensitive'], [200, 'unhealthy'], [300, 'very_unhealthy']];
const EU_BANDS = [[20, 'good'], [40, 'fair'], [60, 'moderate'], [80, 'poor'], [100, 'very_poor']];

const categorize = (bands, last) => (value) => bands.find(([max]) => value <= max)?.[1] ?? last;

export const usCategory = categorize(US_BANDS, 'hazardous');
export const euCategory = categorize(EU_BANDS, 'extremely_poor');

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Pollutant with the highest sub-index; the first in POLLUTANTS order wins a tie
function dominant(subIndices) {
  let best = null;
  for (const [key, value] of subIndices) {
    if (isNumber(value) && (best === null || value > best.value)) best = { key, value };
  }
  return best?.key ?? null;
}

function validateCoordinates({ lat, lon }) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (lat === undefined || lat === '' || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
    throw new ValidationError('Invalid parameter: "lat" must be a number between -90 and 90.');
  }
  if (lon === undefined || lon === '' || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
    throw new ValidationError('Invalid parameter: "lon" must be a number between -180 and 180.');
  }
  return { lat: latNum, lon: lonNum };
}

class AirQualityService {
  /**
   * Current US and European AQI, pollutant concentrations and UV index from Open-Meteo.
   * Throws ValidationError for bad coordinates, SourceUnavailableError if Open-Meteo fails
   * and nothing usable is cached. See docs/api-weather-air.md.
   */
  async getAirQuality(params = {}) {
    const { lat, lon } = validateCoordinates(params);
    // ~1 km is far finer than the model grid, and lets nearby requests share a cache entry
    const latitude = lat.toFixed(2);
    const longitude = lon.toFixed(2);

    const { current, units } = await cached(`airquality:${latitude}:${longitude}`,
      { freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS },
      () => this.#fetchCurrent({ latitude, longitude }));

    const value = (field) => (isNumber(current[field]) ? current[field] : null);

    const pollutants = Object.fromEntries(Object.entries(POLLUTANTS).map(([key, field]) => [
      key,
      value(field) === null ? null : {
        value: value(field),
        unit: units[field] ?? null,
        usAqi: value(`us_aqi_${field}`),
        euAqi: EU_POLLUTANTS.includes(key) ? value(`european_aqi_${field}`) : null,
      },
    ]));

    const scale = (total, categoryOf, keys, prefix) => (total === null ? null : {
      value: total,
      category: categoryOf(total),
      dominant: dominant(keys.map(k => [k, value(`${prefix}${POLLUTANTS[k]}`)])),
    });

    const uv = value('uv_index');

    return {
      query: { lat, lon },
      source: 'open-meteo',
      time: isNumber(current.time) ? new Date(current.time * 1000).toISOString() : null,
      aqi: {
        us: scale(value('us_aqi'), usCategory, Object.keys(POLLUTANTS), 'us_aqi_'),
        eu: scale(value('european_aqi'), euCategory, EU_POLLUTANTS, 'european_aqi_'),
      },
      pollutants,
      uvIndex: uv === null ? null : Math.round(uv * 10) / 10,
    };
  }

  // Open-Meteo `current` object (unix-seconds `time`) and its `current_units`
  async #fetchCurrent({ latitude, longitude }) {
    const params = new URLSearchParams({
      latitude,
      longitude,
      current: CURRENT_FIELDS.join(','),
      timeformat: 'unixtime',
    });
    const url = `${API_URL}?${params}`;
    logger.info(`Calling external API: ${url}`);

    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      logger.error(`Error calling Open-Meteo Air Quality: ${error.message}`);
      throw new SourceUnavailableError('Air quality provider could not be reached.');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      logger.warn(`Open-Meteo Air Quality error: ${response.status} ${body.reason || response.statusText}`);
      throw new SourceUnavailableError(`Air quality provider returned ${response.status}.`);
    }

    const { current, current_units: units } = await response.json();
    if (!current) {
      throw new SourceUnavailableError('Air quality provider returned no current data.');
    }
    return { current, units: units ?? {} };
  }
}

export default new AirQualityService();
