import { Router } from 'express';
import astroService from '../service/astro.js';
import loggers from 'namespaced-console-logger';
import { NotFoundError } from '../common/errors.js';

const router = Router();
const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:astro');

// GET /api/v1/astro/search
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

// GET /api/v1/astro/zenith/{lat}/{long}
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
// GET /api/v1/astro/zenith/starchart/{lat}/{long}
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
