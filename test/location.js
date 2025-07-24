import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';
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

    // Mock the locationService.getLocationByIp method
    t.mock.method(locationService, 'getLocationByIp', async (ipAddress) => {
      assert.strictEqual(ipAddress, mockIp, 'IP address passed to service should match');
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

    // Mock the service to handle the local test IP
    t.mock.method(locationService, 'getLocationByIp', async (ipAddress) => {
      assert.strictEqual(ipAddress, requesterIp, 'Requester IP address passed to service should match');
      return mockLocationData;
    });

    const response = await supertest(app)
      .get('/api/v1/location/')
      .expect(200)
      .expect('Content-Type', /json/);

    assert.deepStrictEqual(response.body, mockLocationData, 'Response body for requester IP should match mocked data');
  });

  // Test for an invalid IP address format
  test.it('should return 400 for an invalid IP address format', async () => {
    const invalidIp = 'not-a-valid-ip';

    await supertest(app)
      .get(`/api/v1/location/${invalidIp}`)
      .expect(400)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.ok(response.body.error, 'Response should contain an error message');
        assert.strictEqual(response.body.error, 'Invalid IP address format.');
      });
  });

  // Test for an IP that the service can't find (e.g., private range)
  test.it('should return 404 if location service returns a "fail" status', async (t) => {
    const privateIp = '10.0.0.1';
    const failResponse = { status: 'fail', message: 'private range', query: privateIp };

    t.mock.method(locationService, 'getLocationByIp', async () => failResponse);

    await supertest(app)
      .get(`/api/v1/location/${privateIp}`)
      .expect(404)
      .expect('Content-Type', /json/)
      .then(response => {
        assert.strictEqual(response.body.message, failResponse.message);
      });
  });

  // Test for a general service error
  test.it('should return 500 if location service throws an error', async (t) => {
    const ip = '1.2.3.4';
    t.mock.method(locationService, 'getLocationByIp', async () => { throw new Error('External API is down'); });
    const response = await supertest(app).get(`/api/v1/location/${ip}`).expect(500);
    assert.strictEqual(response.text, 'Something broke!');
  });

  test.after(async () => process.exit(0));
});