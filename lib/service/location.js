import loggers from 'namespaced-console-logger';
import { isIP } from 'net';
import ipaddr from 'ipaddr.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:location');
const DEV = process.env.DEV_MODE;

function validPublicIP(ip) {
  // Check if the IP is a valid public IP address
  return !DEV && isIP(ip) !== 0 && ipaddr.parse(ip).range() === 'unicast';
}

class LocationService {
  async getLocationByIp(ipAddress) {
    if (DEV) {
      logger.info(`DEV mode enabled, returning mock location for IP: ${ipAddress}`);
      ipAddress = await LocationService.whatsMyIP();
    }

    if (!validPublicIP(ipAddress)) {
      ipAddress = await LocationService.whatsMyIP();
      // logger.warn(`Non-Public IP address provided: ${ipAddress}`);
      // throw new Error('IP address is from a reserved range.');
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
}

export default new LocationService();
