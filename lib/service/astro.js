import { getSecret } from '../common/secrets.js';
import loggers from 'namespaced-console-logger';
import siderealTime from 'astronomia/sidereal';
import coord from 'astronomia/coord';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:astro');

const ASTRO_APP_ID = await getSecret('ASTRO_APP_ID');
const ASTRO_APP_SECRET = await getSecret('ASTRO_APP_SECRET');

logger.info(`Using Astronomy API ID: ${ASTRO_APP_ID ? 'set' : 'not set'}`);
logger.info(`Using Astronomy API SECRET: ${ASTRO_APP_SECRET ? 'set' : 'not set'}`);

class AstroService {
  async searchCelestialObjects(params) {
    // 
    const apiUrl = 'https://api.astronomyapi.com/api/v2/search';

    logger.info(`Searching celestial objects with params: ${JSON.stringify(params)}`);
    // logger.info(`Calling external API: ${apiUrl}`);
    if (!params) {
      throw new Error('No params provided.');
    }

    if (!params.term && (typeof params.ra === 'undefined' || typeof params.dec === 'undefined')) {
      throw new Error('Invalid parameters: Either "term" or both "ra" and "dec" must be provided.');
    }

    if (typeof params.ra !== 'undefined' && typeof params.dec === 'undefined') {
      throw new Error('Invalid parameters: "dec" must be provided if "ra" is provided.');
    }

    if (typeof params.dec !== 'undefined' && typeof params.ra === 'undefined') {
      throw new Error('Invalid parameters: "ra" must be provided if "dec" is provided.');
    }

    if (params.term && params.match_type && !['fuzzy', 'exact'].includes(params.match_type)) {
      throw new Error('Invalid parameter: "match_type" must be "fuzzy" or "exact".');
    }

    if (params.ra) {
      const ra = parseFloat(params.ra);
      if (isNaN(ra)) {
        throw new Error('Invalid parameter: "ra" must be a decimal value.');
      }
    }

    if (params.dec) {
      const dec = parseFloat(params.dec);
      if (isNaN(dec)) {
        throw new Error('Invalid parameter: "dec" must be a decimal value.');
      }
    }

    if (params.limit) {
      const limit = parseInt(params.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        throw new Error('Invalid parameter: "limit" must be a positive integer.');
      }
    }

    if (params.offset) {
      const offset = parseInt(params.offset, 10);
      if (isNaN(offset) || offset < 0) {
        throw new Error('Invalid parameter: "offset" must be a non-negative integer.');
      }
    }

    if (params.order_by && params.order_by !== 'name') {
      throw new Error('Invalid parameter: "order_by" must be "name".');
    }

    if (params.order_by && (params.ra || params.dec)) {
      throw new Error('Invalid parameter: "order_by" is not supported during an area search (RA/DEC).');
    }

    const queryString = new URLSearchParams(params).toString();
    const fullApiUrl = `${apiUrl}?${queryString}`;

    const authString = btoa(`${ASTRO_APP_ID}:${ASTRO_APP_SECRET}`);
    logger.info(`Calling external API with query string: ${fullApiUrl}`);

    const response = await fetch(fullApiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${authString}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
      throw new Error(`Failed to search celestial objects from external API: ${response.statusText}`);
    }
    const data = await response.json();
    logger.info(`Successfully received data from external API for params: ${JSON.stringify(data)}`);
    return data;
  } catch(error) {
    logger.error(`Error calling external Astronomy API: ${error.message}`, error);
    throw error;
  }

  async searchCelestialObjectsByCoordinates(latitude, longitude, date = new Date()) {
    const raDec = AstroService.getRaDec(latitude, longitude, date);
    const ra = raDec.ra;
    const dec = raDec.dec;
    return await this.searchCelestialObjects({ ra, dec });
  }

  static getRaDec(latitude, longitude, date) {
    if (latitude < -90 || latitude > 90) {
      throw new Error('Invalid latitude. Must be between -90 and 90.');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Invalid longitude. Must be between -180 and 180.');
    }

    const lst = siderealTime.apparent(date || new Date(), longitude);
    const zenithAltitude = 90; // degrees
    const zenithAzimuth = 0;   // degrees (arbitrary for zenith)

    const equatorialCoords = new coord.Equatorial(
      zenithAltitude,
      zenithAzimuth,
      latitude,
      lst
    );

    const ra = equatorialCoords.ra; // Right Ascension
    const dec = equatorialCoords.dec; // Declination
    logger.info(`Calculated RA: ${ra}, Dec: ${dec} for Lat: ${latitude}, Long: ${longitude} on Date: ${date}`);
    return { ra, dec };
  }
}


export default new AstroService();
