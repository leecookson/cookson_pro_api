import { Router } from 'express';
import astroService from '../service/astro.js';
import loggers from 'namespaced-console-logger';

const router = Router();
const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:astro');

// GET /api/v1/astro/search
router.get('/search', async (req, res, next) => {
  const params = req.query;
  logger.info(`Received astronomy search request with query: ${JSON.stringify(params)}`);

  try {
    const astroData = await astroService.searchCelestialObjects(params);
    // logger.info(`Successfully returned celestial objects: ${JSON.stringify(astroData)}`);
    if (astroData.data && astroData.data.length === 0) {
      // logger.warn(`No astronomy data found for params: ${JSON.stringify(params)}`);
      res.status(404).json({ message: 'No celestial objects found matching the criteria.' });
    } else if (astroData) {
      res.json(astroData);
    }
  } catch (error) {
    logger.error(`Error searching celestial objects with params: ${JSON.stringify(params)}:`, error.message);
    // Differentiate between validation errors (400) and other errors (500)
    if (error.message.startsWith('Invalid parameters:') || error.message.startsWith('Invalid parameter:')) {
      res.status(400).json({ error: error.message });
    } else {
      next(error); // Pass to the centralized error handler
    }
  }
});

// GET /api/v1/astro/zenith/{lat}/{long}
router.get('/zenith/:lat/:long', async (req, res, next) => {
  const { lat, long } = req.params;
  logger.info(`Received zenith request for lat: ${lat}, long: ${long}`);

  try {
    const astroData = await astroService.searchCelestialObjectsByCoordinates(lat, long);
    if (astroData) {
      logger.info(`Successfully returned zenith data for lat: ${lat}, long: ${long}`);
      res.json(astroData);
    }
  } catch (error) {
    logger.error(`Error fetching zenith data for lat: ${lat}, long: ${long}:`, error.message);
    // Differentiate between validation errors (400) and other errors (500)
    if (error.message.startsWith('Invalid parameters:') || error.message.startsWith('Invalid parameter:')) {
      res.status(400).json({ error: error.message });
    } else {
      next(error); // Pass to the centralized error handler
    }
  }
});

export default router;
