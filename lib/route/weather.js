import { Router } from 'express';
const router = Router();
import weatherService from '../service/weather.js';
import airQualityService from '../service/airquality.js';
import loggers from 'namespaced-console-logger';
import { ValidationError, NotFoundError, SourceUnavailableError, UpstreamError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:weather');

/**
 * @openapi
 * /api/v1/weather/{lat}/{long}:
 *   get:
 *     summary: Current weather by coordinates
 *     tags: [Weather]
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
 *     responses:
 *       200:
 *         description: OpenWeatherMap current weather object
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:lat/:long', async (req, res, next) => {
  const { lat, long } = req.params;
  logger.info(`Received weather request for lat: ${lat}, long: ${long}`);

  // Basic validation for lat/long
  const latitude = parseFloat(lat);
  const longitude = parseFloat(long);

  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    logger.warn(`Invalid latitude provided: ${lat}`);
    return next(new ValidationError('Invalid latitude. Must be between -90 and 90.'));
  }

  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    logger.warn(`Invalid longitude provided: ${long}`);
    return next(new ValidationError('Invalid longitude. Must be between -180 and 180.'));
  }

  try {
    const weatherData = await weatherService.getWeatherByCoordinates(latitude, longitude);
    if (weatherData) {
      logger.info(`Successfully fetched weather data for lat: ${latitude}, long: ${longitude}`);
      res.json(weatherData);
    } else { // This case is hit when the service returns null (e.g., for a 404 from the external API)
      throw new NotFoundError('Weather data not found for the given coordinates.');
    }
  } catch (error) {
    // Pass the error to the centralized error handler in server.js
    next(error);
  }
});

/**
 * @openapi
 * /api/v1/weather/air/{lat}/{lon}:
 *   get:
 *     summary: Current air quality (US and European AQI, pollutants, UV index) by coordinates
 *     description: >
 *       From the Open-Meteo Air Quality API (CAMS model forecasts, worldwide). Either scale is
 *       null when the source has no value for it; the European scale has no CO sub-index.
 *     tags: [Weather]
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
 *     responses:
 *       200:
 *         description: US and European AQI with category and dominant pollutant, pollutant levels and sub-indices, UV index
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       502:
 *         description: Open-Meteo is unavailable and nothing recent is cached
 */
router.get('/air/:lat/:lon', async (req, res, next) => {
  const { lat, lon } = req.params;
  logger.info(`Received air quality request for lat: ${lat}, lon: ${lon}`);

  try {
    const data = await airQualityService.getAirQuality({ lat, lon });
    res.set('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (error) {
    // Air quality has a single source, so its failure is the endpoint's failure
    next(error instanceof SourceUnavailableError ? new UpstreamError(error.message) : error);
  }
});

export default router;