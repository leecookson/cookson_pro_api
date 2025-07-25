
import { getSecret } from '../common/secrets.js';
import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:weather');

const OPEN_API_KEY = await getSecret('OPEN_API_KEY');

logger.info(`Using OpenWeatherMap API key: ${OPEN_API_KEY ? OPEN_API_KEY : 'not set'}`);

class WeatherService {
  async getWeatherByCoordinates(lat, lng) {
    {
      const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${OPEN_API_KEY}`;

      logger.info(`Fetching weather from OpenWeatherMap API for lat: ${lat}, long: ${lng}`);
      logger.info(`Calling external API: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          // If the external API returns 404, it means no data was found for the coordinates.
          // This isn't a server error for us, so we return null to let the route handler send a 404.
          if (response.status === 404) {
            logger.warn(`External API returned 404 for lat: ${lat}, long: ${lng}. No weather data found.`);
            return null;
          }
          // For other errors (401, 500, etc.), we should treat it as a server-side failure.
          const errorBody = await response.text();
          logger.error(`External API error: ${response.status} ${response.statusText} - ${errorBody}`);
          throw new Error(`Failed to fetch weather data from external API: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
      } catch (error) {
        logger.error(`Error calling external weather API: ${error.message}`, error);
        throw error; // Re-throwing to be caught by the route handler's try-catch
      }
    }
  }
  getWeatherTypeIcon(weather) {
    if (!weather || !weather.weather || !weather.weather[0].main) return '';
    const weatherData = weather.weather[0];
    const mainWeather = weatherData.main;
    const windType = api.getWindType(weather.wind.speed);
    console.log('windType', windType, weather.wind.speed);
    const windIcon = api.getWindIcon(windType);

    switch (mainWeather) {
      case 'Clear':
        return windIcon + '☀';
      case 'Rain':
        return windIcon + api.getRainIcon(weather.rain);
      case 'Thunderstorm':
        return '⛈';
      case 'Drizzle':
        return windIcon + '🌧';
      case 'Clouds':
        return windIcon + api.getCloudyIcon(weather.clouds);
      case 'Snow':
        return windIcon + api.getSnowIcon(weather.snow);
      case 'Tornado':
        return '🌪';
      case 'Mist':
      case 'Smoke':
      case 'Haze':
      case 'Fog':
      case 'Sand':
      case 'Dust':
      case 'Ash':
        return windIcon + '🌫';
      default:
        return '';
    }
  }
  getCloudyIcon(clouds) {
    //console.log('CLOUDS', clouds);
    if (!clouds) return '☀';
    if (clouds.all >= 50) return '☁';
    if (clouds.all > 20) return '🌤';
    return '☀';
  }
  getRainIcon(rain) {
    //console.log('RAIN', rain);
    if (!rain) return '';
    if (rain['1h'] > 1.0) return '🌧';
    return '☁';
  }
  getSnowIcon(snow) {
    //console.log('SNOW', snow);
    if (!snow) return '';
    if (snow['1h'] > 2.0) return '❄';
    return '☁';
  }
  getWindType(windSpeed) {
    if (windSpeed < 1.5) return 'calm';
    if (windSpeed < 8.0) return 'breezy';
    if (windSpeed < 17) return 'windy';
    if (windSpeed < 28) return 'gale';
    if (windSpeed < 32) return 'storm';
    return "hurricane"
  }
  getWindIcon(windType) {
    switch (windType) {
      case 'calm': return '';
      case 'breezy': return '';
      case 'windy': return '💨';
      case 'gale': return '🌬';
      case 'storm': return '⛈';
      case 'hurricane': return '🌪';
    }
  }
};

export default new WeatherService();
