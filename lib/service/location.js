import loggers from 'namespaced-console-logger';
import { isIP } from 'net';
import ipaddr from 'ipaddr.js';
import { ValidationError } from '../common/errors.js';
import { getSecret } from '../common/secrets.js';
import { cached } from '../common/cache.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:location');

// Same key as the weather service; OpenWeatherMap's geocoding API is included with it
const OPEN_API_KEY = await getSecret('OPEN_API_KEY');
const REVERSE_GEOCODE_URL = 'https://api.openweathermap.org/geo/1.0/reverse';

// Place names don't change; a month-old lookup is as good as a new one
const PLACE_FRESH_MS = 30 * 24 * 3600000;

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

class LocationService {
  /**
   * Nearest named place to lat/lon, using the same field names as the IP lookup (ip-api.com)
   * so clients can use either: { status, city, regionName, country, countryCode, lat, lon }.
   * Returns null when there is no place nearby (e.g. open ocean).
   */
  async getLocationByCoordinates(lat, lon) {
    // ~1 km: finer than a place name needs, and lets nearby requests share a cache entry
    const latitude = lat.toFixed(2);
    const longitude = lon.toFixed(2);
    const place = await cached(`place:${latitude}:${longitude}`, { freshMs: PLACE_FRESH_MS },
      () => this.#reverseGeocode(latitude, longitude));
    if (!place) return null;

    return {
      status: 'success',
      city: place.name,
      regionName: place.state ?? null,
      country: countryNames.of(place.country) ?? place.country,
      countryCode: place.country,
      lat,
      lon,
    };
  }

  // OpenWeatherMap's nearest place: { name, state, country (ISO code), lat, lon }, or null
  async #reverseGeocode(latitude, longitude) {
    const params = new URLSearchParams({ lat: latitude, lon: longitude, limit: 1, appid: OPEN_API_KEY });
    logger.info(`Reverse geocoding ${latitude}, ${longitude}`);
    const response = await fetch(`${REVERSE_GEOCODE_URL}?${params}`);
    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Reverse geocoding error: ${response.status} ${response.statusText} - ${errorBody}`);
      throw new Error(`Failed to reverse geocode coordinates: ${response.statusText}`);
    }
    const [place] = await response.json();
    return place ? { name: place.name, state: place.state, country: place.country } : null;
  }

  async getLocationByIp(ipAddress) {
    if (!LocationService.validPublicIP(ipAddress)) {
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

}

export const { whatsMyIP, validPublicIP } = LocationService;
export default new LocationService();
