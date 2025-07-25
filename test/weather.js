import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js'; // Import the exported Express app, added .js

// Use test.describe for grouping tests
test.describe('Weather API (/api/v1/weather)', () => {
  test.it('should return 200 and weather data for valid coordinates', async (t) => {
    const mockLat = 34.0522;
    const mockLong = -118.2437;
    const mockWeatherData = {
      coordinates: { lat: mockLat, long: mockLong },
      temperature: 22,
      description: 'Clear sky',
      humidity: 55,
      wind: {
        speed: 5,
        direction: 'N'
      },
      timestamp: new Date().toISOString(),
      source: 'Mocked Weather API'
    };

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url) => {
      const apiKey = process.env.OPEN_API_KEY; // Assuming API key is available in process.env for testing
      const expectedUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${mockLat}&lon=${mockLong}&units=metric&appid=${apiKey}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockWeatherData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await supertest(app)
      .get(`/api/v1/weather/${mockLat}/${mockLong}`)
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockWeatherData, 'Response body should match mocked data');
  });

  test.it('should return 400 for invalid latitude', async () => {
    const invalidLat = 91; // Invalid latitude
    const validLong = -118.2437;

    await supertest(app)
      .get(`/api/v1/weather/${invalidLat}/${validLong}`)
      .expect(400)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.ok(response.body.error, 'Response should contain an error message');
        assert.strictEqual(response.body.error, 'Invalid latitude. Must be between -90 and 90.');
      });
  });

  test.it('should return 400 for invalid longitude', async () => {
    const validLat = 34.0522;
    const invalidLong = -181; // Invalid longitude

    await supertest(app)
      .get(`/api/v1/weather/${validLat}/${invalidLong}`)
      .expect(400)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.ok(response.body.error, 'Response should contain an error message');
        assert.strictEqual(response.body.error, 'Invalid longitude. Must be between -180 and 180.');
      });
  });

  test.it('should return 404 if weather service returns null (e.g., data not found)', async (t) => {
    const lat = 0;
    const long = 0; // Using the coordinates that our mock service returns null for

    // Mock the service to return null
    t.mock.method(globalThis, 'fetch', async (url) => {
      const apiKey = process.env.OPEN_API_KEY;
      const expectedUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${long}&units=metric&appid=${apiKey}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');

      // Return a mock Response object that signifies no data found (e.g., 404 from external API)
      return new Response(JSON.stringify({ cod: '404', message: 'city not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await supertest(app)
      .get(`/api/v1/weather/${lat}/${long}`)
      .expect(404)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.ok(response.body.message, 'Response should contain a message');
        assert.strictEqual(response.body.message, 'Weather data not found for the given coordinates.');
      });
  });

  test.it('should return 500 if weather service throws an error', async (t) => {
    const lat = 10;
    const long = 20;
    const errorMessage = 'Internal Service Error';

    // Mock the global fetch function to simulate a network error or an unhandled 500 from the external API
    t.mock.method(globalThis, 'fetch', async () => {
      // Simulate a network error or an unhandled 500 from the external API
      throw new Error(errorMessage);
    });

    const response = await supertest(app)
      .get(`/api/v1/weather/${lat}/${long}`)
      .expect(500);

    // The default error handler sends 'Something broke!'
    // You might want to make your error handler more specific in the future
    // and then assert the specific error message here.
    assert.strictEqual(response.text, 'Something broke!');
  });

  // --- Tests Demonstrating Fetch Mocking ---

  test.it('should return 200 by mocking fetch for valid coordinates', async (t) => {
    const mockLat = 40.7128;
    const mockLong = -74.0060;
    const mockApiResponse = {
      coord: { lon: mockLong, lat: mockLat },
      weather: [{ id: 800, main: 'Clear', description: 'clear sky', icon: '01d' }],
      main: { temp: 25.3, feels_like: 25.1, temp_min: 23.8, temp_max: 26.7, pressure: 1012, humidity: 45 },
      name: 'New York',
    };
    const apiKey = process.env.OPEN_API_KEY; // Loaded by -r dotenv-safe/config

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url) => {
      const expectedUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${mockLat}&lon=${mockLong}&units=metric&appid=${apiKey}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockApiResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // This test now goes through the route to the *actual* service.
    // The service's `fetch` call is intercepted by our mock above.
    const response = await supertest(app)
      .get(`/api/v1/weather/${mockLat}/${mockLong}`)
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockApiResponse, 'Response body should match the mocked API response');
  });

  test.it('should handle external API errors by mocking fetch to return a non-200 status', async (t) => {
    const mockLat = 1.1;
    const mockLong = 2.2;

    // Mock fetch to simulate an external API failure (e.g., invalid API key)
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response('Invalid API key', { status: 401, statusText: 'Unauthorized' });
    });

    // The service should throw an error, which the app's central error handler catches.
    await supertest(app)
      .get(`/api/v1/weather/${mockLat}/${mockLong}`)
      .expect(500);
  });

  // Add an after hook to ensure the process exits cleanly after all tests in this describe block
  test.after(async () => {
    process.exit(0);
  });
});