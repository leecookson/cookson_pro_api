import { Router } from 'express';
import locationService from '../service/location.js';
import loggers from 'namespaced-console-logger';
import { isIP } from 'net';
import { ValidationError, NotFoundError } from '../common/errors.js';

const router = Router();
const logger = loggers(process.env.LOG_LEVEL || 'info').get('route:location');



/**
 * Common handler to fetch and respond with location data.
 * @param {string} ipAddress - The IP address to look up.
 * @param {object} res - The Express response object.
 * @param {function} next - The Express next middleware function.
 */
const getLocation = async (ipAddress, res, next) => {
  try {
    const locationData = await locationService.getLocationByIp(ipAddress);
    if (locationData && locationData.status !== 'fail') {
      logger.info(`Successfully fetched location data for IP: ${ipAddress}`);
      res.json(locationData);
    } else {
      const message = (locationData && locationData.message) ? locationData.message : 'Location data not found for the given IP address.';
      logger.warn(`No location data found for IP: ${ipAddress} - Message: ${message}`);
      res.status(404).json({ message });
    }
  } catch (error) {
    logger.error(`Error fetching location for IP: ${ipAddress}:`, error.message);
    next(error);
  }
};

// GET /api/v1/location - get location for the requesting IP
router.get('/', async (req, res, next) => {
  // Note: For this to work correctly behind a proxy, app.set('trust proxy', true) should be set in app.js
  const ipAddress = req.ip;
  try {
    logger.info(`Retrieving location request for requester's IP: ${ipAddress}`);
    await getLocation(ipAddress, res, next);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/location/:ipAddress
router.get('/:ipAddress', async (req, res, next) => {
  const { ipAddress } = req.params;
  logger.info(`Received location request for specific IP: ${ipAddress}`);
  await getLocation(ipAddress, res, next);
});

export default router;