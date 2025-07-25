import { getSecret } from '../common/secrets.js';
import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:astro');

const ASTRO_APP_ID = await getSecret('ASTRO_APP_ID');
const ASTRO_APP_SECRET = await getSecret('ASTRO_APP_SECRET');

logger.info(`Using Astronomy API ID: ${ASTRO_APP_ID ? 'set' : 'not set'}`);
logger.info(`Using Astronomy API SECRET: ${ASTRO_APP_SECRET ? 'set' : 'not set'}`);

class AstroService {
  async searchCelestialObjects(params) {
    const apiUrl = 'https://api.astronomyapi.com/api/v2/search';

    logger.info(`Searching celestial objects with params: ${JSON.stringify(params)}`);
    // logger.info(`Calling external API: ${apiUrl}`);
    if (!params || (
      !params.term &&
      (!params.ra || !params.dec)
    )) {
      throw new Error('Invalid parameters: Either "term" or both "ra" and "dec" must be provided.');
    }

    if (params.ra && !params.dec) {
      throw new Error('Invalid parameters: "dec" must be provided if "ra" is provided.');
    }

    if (params.dec && !params.ra) {
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
}


export default new AstroService();
