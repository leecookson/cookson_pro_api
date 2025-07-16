
import loggers from 'namespaced-console-logger';

const logger = loggers().get('server:weather');

// Placeholder for the external API URL and key
const EXTERNAL_API_URL_BASE = 'https://api.tbdweather.com/v1/current'; // Replace with actual API
const API_KEY = 'YOUR_TBD_API_KEY'; // Replace with your actual API key

class WeatherService {
  /**
 * Fetches weather data for given latitude and longitude.
 * @param {number} lat - Latitude
 * @param {number} long - Longitude
 * @returns {Promise<object|null>} A promise that resolves to the weather data object, or null if not found/error.
 */
  async getWeatherByCoordinates(lat, long) {
    logger.info(`Fetching weather from external API for lat: ${lat}, long: ${long}`);

    try {
      const apiUrl = `${EXTERNAL_API_URL_BASE}?lat=${lat}&lon=${long}&appid=${API_KEY}&units=metric`;
      logger.info(`Calling external API: ${apiUrl}`);
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
        throw new Error(`Failed to fetch weather data from external API: ${response.statusText}`);
      }
      const data = await response.json();
      logger.info(`Successfully received data from external API for lat: ${lat}, long: ${long}`);
      return data; // Or transform it to a desired format
    } catch (error) {
      logger.error(`Error calling external weather API: ${error.message}`, error);
      // Depending on how you want to handle errors, you might re-throw,
      // or return null/undefined to be handled by the route.
      throw error; // Re-throwing to be caught by the route handler's try-catch
    }
  }
}

export default new WeatherService();
