import { getSecret } from '../common/secrets.js';
import loggers from 'namespaced-console-logger';
import { ValidationError } from '../common/errors.js';
import { apparent } from 'astronomia/sidereal';
import { Horizontal } from 'astronomia/coord';
import { Calendar } from 'astronomia/julian';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:astro');

const ASTRO_APP_ID = await getSecret('ASTRO_APP_ID');
const ASTRO_APP_SECRET = await getSecret('ASTRO_APP_SECRET');

logger.info(`Using Astronomy API ID: ${ASTRO_APP_ID ? 'set' : 'not set'}`);
logger.info(`Using Astronomy API SECRET: ${ASTRO_APP_SECRET ? 'set' : 'not set'}`);


class AstroService {
  static generateAuthHeader() {
    const authString = btoa(`${ASTRO_APP_ID}:${ASTRO_APP_SECRET}`);
    return `Basic ${authString}`;
  }

  async searchCelestialObjects(params) {
    // 
    const apiUrl = 'https://api.astronomyapi.com/api/v2/search';

    logger.info(`Searching celestial objects with params: ${JSON.stringify(params)}`);
    // logger.info(`Calling external API: ${apiUrl}`);
    if (!params) {
      throw new ValidationError('No params provided.');
    }

    if (!params.term && (typeof params.ra === 'undefined' || typeof params.dec === 'undefined')) {
      throw new ValidationError('Invalid parameters: Either "term" or both "ra" and "dec" must be provided.');
    }

    if (typeof params.ra !== 'undefined' && typeof params.dec === 'undefined') {
      throw new ValidationError('Invalid parameters: "dec" must be provided if "ra" is provided.');
    }

    if (typeof params.dec !== 'undefined' && typeof params.ra === 'undefined') {
      throw new ValidationError('Invalid parameters: "ra" must be provided if "dec" is provided.');
    }

    if (params.term && params.match_type && !['fuzzy', 'exact'].includes(params.match_type)) {
      throw new ValidationError('Invalid parameter: "match_type" must be "fuzzy" or "exact".');
    }

    if (params.ra) {
      const ra = parseFloat(params.ra);
      if (isNaN(ra)) {
        throw new ValidationError('Invalid parameter: "ra" must be a decimal value.');
      }
    }

    if (params.dec) {
      const dec = parseFloat(params.dec);
      if (isNaN(dec)) {
        throw new ValidationError('Invalid parameter: "dec" must be a decimal value.');
      }
    }

    if (params.limit) {
      const limit = parseInt(params.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        throw new ValidationError('Invalid parameter: "limit" must be a positive integer.');
      }
    }

    if (params.offset) {
      const offset = parseInt(params.offset, 10);
      if (isNaN(offset) || offset < 0) {
        throw new ValidationError('Invalid parameter: "offset" must be a non-negative integer.');
      }
    }

    if (params.order_by && params.order_by !== 'name') {
      throw new ValidationError('Invalid parameter: "order_by" must be "name".');
    }

    if (params.order_by && (params.ra || params.dec)) {
      throw new ValidationError('Invalid parameter: "order_by" is not supported during an area search (RA/DEC).');
    }

    try {
      const queryString = new URLSearchParams(params).toString();
      const fullApiUrl = `${apiUrl}?${queryString}`;

      logger.info(`Calling external API with query string: ${fullApiUrl}`);

      const response = await fetch(fullApiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': AstroService.generateAuthHeader()
        }
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
        throw new Error(`Failed to search celestial objects from external API: ${response.statusText}`);
      }
      // logger.info(`Successfully received data from external API for params: ${JSON.stringify(data)}`);
      return response.json();
    } catch (error) {
      logger.error(`Error calling external Astronomy API: ${error.message}`, error);
      throw error;
    }
  }

  async generateStarChart(params = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30-second timeout

    try {
      const apiUrl = 'https://api.astronomyapi.com/api/v2/studio/star-chart';
      const { latitude, longitude, date, zoom } = params;

      logger.info(`Generating star chart for lat: ${latitude}, long: ${longitude}, date: ${date}, zoom: ${zoom}`);
      const isoDate = date ? date.toISOString().split('T')[0] : null;
      const raDec = AstroService.getZenithRaDec(latitude, longitude, date || new Date());
      const ra = raDec.rightAscension;
      const dec = raDec.declination;

      const requestBody = {
        "style": "default",
        "observer": {
          "latitude": parseFloat(latitude || 0),
          "longitude": parseFloat(longitude || 0),
          "date": isoDate
        },
        "view": {
          "type": "area",
          "parameters": {
            "position": {
              "equatorial": {
                "rightAscension": parseFloat(ra || 0),
                "declination": parseFloat(dec || 89.9)
              }
            },
            "zoom": parseInt(zoom || 3, 10)
          }
        }
      }

      logger.info(`Calling external API with body: ${JSON.stringify(requestBody)}`);
      const postFetch = {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': AstroService.generateAuthHeader()
        },
        body: JSON.stringify(requestBody)
      }

      const response = await fetch(apiUrl, postFetch);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
        throw new Error(`Failed to generate star chart from external API: ${response.statusText}`);
      }
      const data = await response.json();
      logger.info(`Successfully received star chart data from external API`, data);
      return data.data; // The API response nests imageUrl under a "data" object
    } catch (error) {
      logger.error(`Error in generateStarChart: ${error.message}`, error);
      throw error; // Re-throw to be caught by the route handler
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async searchCelestialObjectsByCoordinates(latitude, longitude, date = new Date(), limit = 3) {
    const raDec = AstroService.getZenithRaDec(latitude, longitude, date);
    const ra = raDec.rightAscension;
    const dec = raDec.declination;
    const responseData = await this.searchCelestialObjects({ ra, dec, limit });
    responseData.query = { ra, dec, date, limit };
    return responseData;
  }

  /**
   * Calculates the Greenwich Mean Sidereal Time (GMST) in hours for a given Date object.
   * This formula is based on a standard astronomical calculation and is more accurate
   * than a simple approximation.
   * @param {Date} date - The date and time to calculate GMST for.
   * @returns {number} The GMST in hours.
   */
  static getGMST(date) {
    // Julian Day at 0h UTC on the date's day
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1; // getUTCMonth is 0-indexed
    const day = date.getUTCDate();

    // Formula for Julian Day from a Gregorian date
    let a = Math.floor((14 - month) / 12);
    let y = year + 4800 - a;
    let m = month + 12 * a - 3;
    let jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045.5;

    // Time of day in hours
    const h = date.getUTCHours();
    const min = date.getUTCMinutes();
    const sec = date.getUTCSeconds();
    const ms = date.getUTCMilliseconds();
    const ut = h + min / 60 + sec / 3600 + ms / 3600000;

    // Julian centuries from J2000.0
    const t = (jd - 2451545.0) / 36525;

    // GMST formula based on precession
    let gmstHours = 6.697374558 + 1.00273790935 * ut + (8640184.812866 * t + 0.093104 * t * t - 0.0000062 * t * t * t) / 3600;

    // Normalize GMST to be between 0 and 24 hours
    gmstHours = gmstHours % 24;
    if (gmstHours < 0) {
      gmstHours += 24;
    }

    return gmstHours;
  }

  static getZenithRaDec(latitude, longitude, date) {
    if (latitude < -90 || latitude > 90) {
      throw new ValidationError('Invalid latitude. Must be between -90 and 90.');
    }
    if (longitude < -180 || longitude > 180) {
      throw new ValidationError('Invalid longitude. Must be between -180 and 180.');
    }

    // 1. Declination of the zenith equals the observer's latitude.
    const declination = latitude;

    // 2. Get the Greenwich Mean Sidereal Time (GMST) in hours.
    const gmstHours = AstroService.getGMST(date);

    // 3. Calculate Local Sidereal Time (LST) which is the zenith's RA.
    const longitudeHours = longitude / 15; // 15 degrees per hour
    let rightAscension = gmstHours + longitudeHours;

    // 4. Normalize RA to be between 0 and 24 hours.
    rightAscension = rightAscension % 24;
    if (rightAscension < 0) {
      rightAscension += 24;
    }

    return {
      rightAscension: rightAscension,
      declination: declination
    };
  }
}

// Example usage:
// Latitude and longitude for Burlington Township, New Jersey
const latitude = 40.0526;
const longitude = -74.8390;

// Example of real-time calculation
const now = new Date();

const radec = AstroService.getZenithRaDec(latitude, longitude, now);

// const astro = new AstroService();
// const result = await astro.searchCelestialObjects({ ra: radec.rightAscension, dec: radec.declination, limit: 3 });



// Chara
// "rightAscension": {
//   "hours": "12.56",
//     "string": "12h 33m 44s"
// },
// "declination": {
//   "degrees": "41.36",
//     "string": "41° 21' 27\""
// }

// Cor Caroli

//     "hours": "12.93",
//     "degrees": "38.32",

// Messier 94 
// hours 12 50 53
// degrees  41 07 14

// Arcturus
// 14.26
// 19.18

// beta bootis
// 15 01
// 40.5

// calculated now
// 13.991
// 40.005
export default new AstroService();
