import { Router } from 'express';
import astroService from '../service/astro.js';
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

export default router;
