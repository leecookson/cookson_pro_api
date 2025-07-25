import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:location');

class LocationService {
  async getLocationByIp(ipAddress) {
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
}

export default new LocationService();
