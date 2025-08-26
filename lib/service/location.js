import loggers from 'namespaced-console-logger';
import { isIP } from 'net';
import ipaddr from 'ipaddr.js';
import { ValidationError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:location');
const DEV = process.env.DEV;

class LocationService {
  async getLocationByIp(ipAddress) {
    if (LocationService.isDevMode()) {
      logger.info(`DEV mode enabled, returning dev's network IP: ${ipAddress}`);
      ipAddress = await LocationService.whatsMyIP();
    } else if (!LocationService.validPublicIP(ipAddress)) {
      logger.error(`Invalid public IP detected: ${ipAddress}`);
      throw new ValidationError(`Invalid public IP address: ${ipAddress}`);
    }

    const apiUrl = `http://ip-api.com/json/${ipAddress}`;

    logger.info(`Fetching location from ip-api.com for IP: ${ipAddress}`);
    logger.info(`Calling external API: ${apiUrl}`);

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
        throw new Error(`Failed to fetch location data from external API: ${response.statusText}`);
      }
      const data = await response.json();
      logger.info(`Successfully received data from external API for IP: ${ipAddress}`);
      return data;
    } catch (error) {
      logger.error(`Error calling external location API: ${error.message}`, error);
      throw error; // Re-throwing to be caught by the route handler's try-catch
    }
  }

  static async whatsMyIP() {
    const apiUrl = 'https://api.ipify.org?format=json';
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
        throw new Error(`Failed to fetch IP address from external API: ${response.statusText}`);
      }
      const data = await response.json();
      logger.info(`Successfully received IP address from external API: ${data.ip}`);
      return data.ip;
    } catch (error) {
      logger.error(`Error calling external IP API: ${error.message}`, error);
      throw error; // Re-throwing to be caught by the route handler's try-catch
    }
  }

  static validPublicIP(ip) {
    // Check if the IP is a valid public IP address
    try {
      const ipParsed = ipaddr.parse(ip).range();
      return isIP(ip) !== 0 && ipParsed === 'unicast';
    } catch (error) {
      logger.error(`Error parsing IP address: ${error.message}`, error);
      return false;
    }
  }

  static isDevMode() {
    return DEV;
  }
}

export default new LocationService();
