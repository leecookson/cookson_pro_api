import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js'; // Import the exported Express app, added .js
import weatherService from '../lib/service/weather.js'; // Import the service to mock it, added .js

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

    // Mock the weatherService.getWeatherByCoordinates method
    // It will be automatically restored after this test case by node:test's t.mock.method
    t.mock.method(weatherService, 'getWeatherByCoordinates', async (lat, long) => {
      assert.strictEqual(lat, mockLat, 'Latitude passed to service should match');
      assert.strictEqual(long, mockLong, 'Longitude passed to service should match');
      return mockWeatherData;
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
    t.mock.method(weatherService, 'getWeatherByCoordinates', async () => {
      return null;
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

    // Mock the service to throw an error
    t.mock.method(weatherService, 'getWeatherByCoordinates', async () => {
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

  // Add an after hook to ensure the process exits cleanly after all tests in this describe block
  test.after(async () => {
    process.exit(0);
  });
});