import { Router } from 'express';
import locationService from '../service/location.js';
import loggers from 'namespaced-console-logger';

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
      const message = locationData ? locationData.message : 'Location data not found for the given IP address.';
      logger.warn(`No location data found for IP: ${ipAddress} - Message: ${message}`);
      res.status(404).json({ message });
    }
  } catch (error) {
    logger.error(`Error fetching location for IP: ${ipAddress}:`, error.message);
    next(error);
  }
};

// GET /api/v1/location - get location for the requesting IP
router.get('/', (req, res, next) => {
  // Note: For this to work correctly behind a proxy, app.set('trust proxy', true) should be set in app.js
  const ipAddress = req.ip;
  try {
    logger.info(`Retrieving location request for requester's IP: ${ipAddress}`);
    getLocation(ipAddress, res, next);
  } catch (e) {
    logger.warn(`Error retrieving data for IP address ${ipAddress}`);
    return res.status(404).json({ error: 'Cannot find ip address info.' });
  }

});

// GET /api/v1/location/:ipAddress
router.get('/:ipAddress', (req, res, next) => {
  const { ipAddress } = req.params;
  logger.info(`Received location request for specific IP: ${ipAddress}`);

  if (!validPublicIP(ipAddress)) {
    logger.warn(`Non-Public IP address provided: ${ipAddress}`);
    return res.status(400).json({ error: 'IP address is from a reserved range.' });
  }
  try {
    logger.info(`Retrieving location request for IP: ${ipAddress}`);
    getLocation(ipAddress, res, next);
  } catch (e) {
    return res.status(404).json({ error: 'Cannot find ip address info.' });
  }

});

export default router;