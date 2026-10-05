import { Router } from 'express';
import astroService from '../service/astro.js';
import sunMoonService from '../service/sunmoon.js';
import tonightService from '../service/tonight.js';
import loggers from 'namespaced-console-logger';
import { NotFoundError } from '../common/errors.js';

const router = Router();
const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:astro');

/**
 * @openapi
 * /api/v1/astro/search:
 *   get:
 *     summary: Search celestial objects by name or RA/Dec
 *     tags: [Astro]
 *     parameters:
 *       - in: query
 *         name: term
 *         schema: { type: string }
 *         description: Name search term (required if ra/dec not provided)
 *       - in: query
 *         name: match_type
 *         schema: { type: string, enum: [fuzzy, exact] }
 *         description: Match type for term search
 *       - in: query
 *         name: ra
 *         schema: { type: number }
 *         description: Right ascension in decimal hours (required with dec)
 *       - in: query
 *         name: dec
 *         schema: { type: number }
 *         description: Declination in decimal degrees (required with ra)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *         description: Max results to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0 }
 *         description: Pagination offset
 *       - in: query
 *         name: order_by
 *         schema: { type: string, enum: [name] }
 *         description: Sort order (not supported with RA/Dec search)
 *     responses:
 *       200:
 *         description: Astronomy API search results
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/search', async (req, res, next) => {
  const params = req.query;
  logger.info(`Received astronomy search request with query: ${JSON.stringify(params)}`);

  try {
    const astroData = await astroService.searchCelestialObjects(params);

    // logger.info(`Successfully returned celestial objects: ${JSON.stringify(astroData)}`);
    if (!astroData || !astroData.data || astroData.data.length === 0) {
      throw new NotFoundError('No celestial objects found matching the criteria.');
    }
    res.json(astroData);
  } catch (error) {
    next(error); // Pass all errors to the centralized handler
  }
});

/**
 * @openapi
 * /api/v1/astro/zenith/{lat}/{long}:
 *   get:
 *     summary: Celestial objects at the zenith for given coordinates
 *     tags: [Astro]
 *     parameters:
 *       - in: path
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude
 *       - in: path
 *         name: long
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *         description: Max results (default 3)
 *     responses:
 *       200:
 *         description: Astronomy API search results for the current zenith RA/Dec
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/zenith/:lat/:long', async (req, res, next) => {
  const { lat, long } = req.params;
  const { limit } = req.query
  logger.info(`Received zenith request for lat: ${lat}, long: ${long}`);

  try {
    const astroData = await astroService.searchCelestialObjectsByCoordinates(lat, long, new Date(), limit);
    if (astroData) {
      logger.info(`Successfully returned zenith data for lat: ${lat}, long: ${long}`);
      res.json(astroData);
    }
  } catch (error) {
    next(error); // Pass all errors to the centralized handler
  }
});
/**
 * @openapi
 * /api/v1/astro/zenith/starchart/{lat}/{long}:
 *   get:
 *     summary: Star chart image for the zenith at given coordinates
 *     tags: [Astro]
 *     parameters:
 *       - in: path
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude
 *       - in: path
 *         name: long
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude
 *       - in: query
 *         name: zoom
 *         schema: { type: integer, minimum: 1 }
 *         description: Zoom level (default 3)
 *     responses:
 *       200:
 *         description: Astronomy API star chart data including image URL
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/zenith/starchart/:lat/:long', async (req, res, next) => {
  const { lat, long } = req.params;
  const { zoom } = req.query
  logger.info(`Received zenith request for lat: ${lat}, long: ${long}`);

  try {
    const astroData = await astroService.generateStarChart({ latitude: lat, longitude: long, date: new Date(), zoom });
    if (astroData) {
      logger.info(`Successfully returned zenith starchart for lat: ${lat}, long: ${long}`);
      res.json(astroData);
    }
  } catch (error) {
    next(error); // Pass all errors to the centralized handler
  }
});

/**
 * @openapi
 * /api/v1/astro/sunmoon/{lat}/{lon}:
 *   get:
 *     summary: Sun and moon rise/set/transit, twilight, and moon phase for a local date
 *     tags: [Astro]
 *     parameters:
 *       - in: path
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude
 *       - in: path
 *         name: lon
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Local calendar date (YYYY-MM-DD) in tz. Default today in tz
 *       - in: query
 *         name: tz
 *         schema: { type: string }
 *         description: IANA time zone, e.g. America/Los_Angeles. Default UTC
 *     responses:
 *       200:
 *         description: Sun and moon times; timestamps are ISO 8601 with the offset of tz, null if the event does not occur that day
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get('/sunmoon/:lat/:lon', (req, res, next) => {
  const { lat, lon } = req.params;
  const { date, tz } = req.query;
  logger.info(`Received sunmoon request for lat: ${lat}, lon: ${lon}, date: ${date}, tz: ${tz}`);

  try {
    const data = sunMoonService.getSunMoon({ lat, lon, date, tz });
    // position, nextRise and nextSet are relative to the time of the request
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (error) {
    next(error); // Pass all errors to the centralized handler
  }
});

/**
 * @openapi
 * /api/v1/astro/tonight/{lat}/{lon}:
 *   get:
 *     summary: Stargazing conditions for the evening (sunset + 1 hour to local midnight)
 *     description: >
 *       Superset of /sunmoon (same query, sun and moon fields) plus the viewing window, the
 *       cloud forecast, and objects viewable in the window (ISS passes). Sections that cannot
 *       be filled are null, and objects that cannot be computed are left out, with the reason
 *       under unavailable. More sections and objects will be added as data sources are added.
 *     tags: [Astro]
 *     parameters:
 *       - in: path
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude
 *       - in: path
 *         name: lon
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Local calendar date (YYYY-MM-DD) in tz. Default today in tz
 *       - in: query
 *         name: tz
 *         schema: { type: string }
 *         description: IANA time zone, e.g. America/Los_Angeles. Default UTC
 *     responses:
 *       200:
 *         description: Sun, moon, viewing window and cloud forecast for the evening
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get('/tonight/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  const { date, tz } = req.query;
  logger.info(`Received tonight request for lat: ${lat}, lon: ${lon}, date: ${date}, tz: ${tz}`);

  try {
    const data = await tonightService.getTonight({ lat, lon, date, tz });
    // Includes the /sunmoon fields that are relative to the time of the request
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (error) {
    next(error); // Pass all errors to the centralized handler
  }
});

export default router;
