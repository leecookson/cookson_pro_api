import { Router } from 'express';
import locationService, { whatsMyIP } from '../service/location.js';
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

/**
 * @openapi
 * /api/v1/location:
 *   get:
 *     summary: Geolocate the requesting IP address
 *     tags: [Location]
 *     responses:
 *       200:
 *         description: ip-api.com location object
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/', async (req, res, next) => {
  // Note: For this to work correctly behind a proxy, app.set('trust proxy', true) should be set in app.js
  // In dev mode req.ip is 127.0.0.1 (not routable), so substitute the machine's real public IP.
  let ipAddress = req.ip;
  try {
    if (process.env.DEV) {
      ipAddress = await whatsMyIP();
      logger.info(`DEV mode: substituting public IP ${ipAddress} for ${req.ip}`);
    }
    logger.info(`Retrieving location request for requester's IP: ${ipAddress}`);
    await getLocation(ipAddress, res, next);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/v1/location/{lat}/{lon}:
 *   get:
 *     summary: Nearest named place to coordinates (reverse geocoding)
 *     description: Uses the same field names as the IP lookup, so a client can use either.
 *     tags: [Location]
 *     parameters:
 *       - in: path
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *       - in: path
 *         name: lon
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *     responses:
 *       200:
 *         description: "{ status, city, regionName, country, countryCode, lat, lon }"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:lat/:lon', async (req, res, next) => {
  const lat = Number(req.params.lat);
  const lon = Number(req.params.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return next(new ValidationError('Invalid latitude. Must be between -90 and 90.'));
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return next(new ValidationError('Invalid longitude. Must be between -180 and 180.'));
  }
  try {
    const place = await locationService.getLocationByCoordinates(lat, lon);
    if (!place) return next(new NotFoundError('No named place near these coordinates.'));
    res.json(place);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/v1/location/{ipAddress}:
 *   get:
 *     summary: Geolocate a specific IP address
 *     tags: [Location]
 *     parameters:
 *       - in: path
 *         name: ipAddress
 *         required: true
 *         schema: { type: string }
 *         description: IPv4 or IPv6 address
 *     responses:
 *       200:
 *         description: ip-api.com location object
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:ipAddress', async (req, res, next) => {
  const { ipAddress } = req.params;
  logger.info(`Received location request for specific IP: ${ipAddress}`);
  await getLocation(ipAddress, res, next);
});

export default router;