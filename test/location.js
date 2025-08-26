import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';

// Mock the LocationService to control isLocalIP behavior
import locationService from '../lib/service/location.js';

test.describe('Location API (/api/v1/location)', () => {

  // Test for a specific, valid IP address
  test.it('should return 200 and location data for a valid IP address', async (t) => {
    const mockIp = '8.8.8.8';
    const mockLocationData = {
      status: 'success',
      country: 'United States',
      countryCode: 'US',
      region: 'VA',
      regionName: 'Virginia',
      city: 'Ashburn',
      zip: '20149',
      lat: 39.0438,
      lon: -77.4874,
      timezone: 'America/New_York',
      isp: 'Google LLC',
      org: 'Google LLC',
      as: 'AS15169 Google LLC',
      query: '8.8.8.8'
    };

    // Mock the global isDevMode to ignore local dev override
    t.mock.method(locationService.constructor, 'isDevMode', () => false);

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url) => {
      const expectedUrl = `http://ip-api.com/json/${mockIp}`;
      assert.strictEqual(url, expectedUrl, 'The correct API URL should be fetched.');

      // Return a mock Response object
      return new Response(JSON.stringify(mockLocationData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      return mockLocationData;
    });

    const response = await supertest(app)
      .get(`/api/v1/location/${mockIp}`)
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockLocationData, 'Response body should match mocked data');
  });

  // Test for the requester's IP address
  test.it('should return 200 and location data for the requester\'s IP', async (t) => {
    // supertest sends requests from 127.0.0.1, which req.ip sees as ::ffff:127.0.0.1
    const requesterIp = '::ffff:127.0.0.1';
    const mockLocationData = {
      status: 'success',
      country: 'Testland',
      city: 'Testville',
      query: requesterIp
    };

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === 'https://api.ipify.org?format=json') {
        // First call: whatsMyIP
        return new Response(JSON.stringify({ ip: requesterIp }), { status: 200 }); // Mock a public IP
      } else if (url === `http://ip-api.com/json/${requesterIp}`) {
        // Second call: getLocationByIp with the mocked public IP
        return new Response(JSON.stringify(mockLocationData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else
        throw new Error(`Unexpected fetch URL: ${url}`);
    });


    const response = await supertest(app)
      .get('/api/v1/location/')
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockLocationData, 'Response body for requester IP should match mocked data');
  });

  // Test for an invalid IP address format
  test.it('should return 400 for an invalid IP address format', async (t) => {
    const invalidIp = 'not-a-valid-ip';
    const mockLocationData = {
      status: 'success',
      country: 'Testland',
      city: 'Testville',
      query: '192.0.2.1'
    };

    // Mock the global isDevMode to ignore local dev override
    t.mock.method(locationService.constructor, 'isDevMode', () => false);

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === 'http://ip-api.com/json/not-a-valid-ip') {
        // Second call: getLocationByIp with the mocked public IP
        return new Response(JSON.stringify(mockLocationData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else
        throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const envDEV = process.env.DEV;
    process.env.DEV = null;
    await supertest(app)
      .get(`/api/v1/location/${invalidIp}`)
      .expect(400)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.ok(response.body.message, 'Response should contain an error message');
        assert.strictEqual(response.body.message, 'Invalid public IP address: not-a-valid-ip');
      });
    process.env.DEV = envDEV;
  });

  // Test for an IP that the service can't find (e.g., private range)
  // TODO: evaluate if this is needed, most "bad" IPs will be caught by the validPublicIP
  test.it.only('should return 400 if location service returns a "fail" status', async (t) => {
    const privateIp = '10.0.0.1';
    const failResponse = { status: 'fail', message: 'private range', query: privateIp };

    // Mock the global isDevMode to ignore local dev override
    t.mock.method(locationService.constructor, 'isDevMode', () => false);

    // Mock the global fetch function to return a "fail" status
    t.mock.method(globalThis, 'fetch', async (url) => {
      if (url === `http://ip-api.com/json/${privateIp}`) {
        // Second call: getLocationByIp with the mocked public IP
        return new Response(JSON.stringify(failResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    });

    await supertest(app)
      .get(`/api/v1/location/${privateIp}`)
      .expect(400)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.strictEqual(response.body.message, 'Invalid public IP address: 10.0.0.1');
      });
  });

  // Test for a general service error
  test.it('should return 500 if location service throws an error', async (t) => {
    const ip = '1.2.3.4';
    // Mock fetch to simulate a network error or an unhandled 500 from the external API
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Failed to fetch');
    });
    const response = await supertest(app).get(`/api/v1/location/${ip}`).expect(500);
    assert.strictEqual(response.body.message, 'Something broke!');
  });

  // --- Tests Demonstrating Fetch Mocking ---

  test.it('should return 200 by mocking fetch for a valid IP address', async (t) => {
    const mockIp = '8.8.4.4';
    const mockApiResponse = {
      status: 'success',
      country: 'United States',
      query: '8.8.4.4'
    };

    // Mock the global fetch function
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === 'https://api.ipify.org?format=json') {
        // First call: whatsMyIP
        return new Response(JSON.stringify({ ip: mockIp }), { status: 200 }); // Mock a public IP
      } else if (url === `http://ip-api.com/json/${mockIp}`) {
        // Second call: getLocationByIp with the mocked public IP
        return new Response(JSON.stringify(mockApiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
    });

    // This test now goes through the route to the *actual* service.
    // The service's `fetch` call is intercepted by our mock above.
    const response = await supertest(app)
      .get(`/api/v1/location/${mockIp}`)
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockApiResponse, 'Response body should match the mocked API response');
  });

  test.it('should handle external API errors by mocking fetch to return a non-200 status', async (t) => {
    const mockIp = '1.2.3.4';

    // Mock fetch to simulate an external API failure
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    });

    // The service should throw an error, which the app's central error handler catches.
    await supertest(app).get(`/api/v1/location/${mockIp}`).expect(500);
  });

  test.after(async () => process.exit(0));
});