import { Router } from 'express';
const router = Router();
import weatherService from '../service/weather.js';
import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:weather');

// GET /api/v1/weather/:lat/:long
router.get('/:lat/:long', async (req, res, next) => {
  const { lat, long } = req.params;
  logger.info(`Received weather request for lat: ${lat}, long: ${long}`);

  // Basic validation for lat/long
  const latitude = parseFloat(lat);
  const longitude = parseFloat(long);

  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    logger.warn(`Invalid latitude provided: ${lat}`);
    return res.status(400).json({ error: 'Invalid latitude. Must be between -90 and 90.' });
  }

  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    logger.warn(`Invalid longitude provided: ${long}`);
    return res.status(400).json({ error: 'Invalid longitude. Must be between -180 and 180.' });
  }

  try {
    const weatherData = await weatherService.getWeatherByCoordinates(latitude, longitude);
    if (weatherData) {
      logger.info(`Successfully fetched weather data for lat: ${latitude}, long: ${longitude}`);
      res.json(weatherData);
    } else {
      // This case might occur if the external API call fails in a way that returns null/undefined
      // but doesn't throw an error handled by the catch block.
      logger.warn(`No weather data found for lat: ${latitude}, long: ${longitude}`);
      res.status(404).json({ message: 'Weather data not found for the given coordinates.' });
    }
  } catch (error) {
    logger.error(`Error fetching weather for lat: ${latitude}, long: ${longitude}:`, error.message);
    // Pass the error to the centralized error handler in server.js
    next(error);
  }
});

export default router;