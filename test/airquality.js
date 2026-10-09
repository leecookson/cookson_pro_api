import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';
import { clearMemoryCache } from '../lib/common/cache.js';
import { usCategory, euCategory } from '../lib/service/airquality.js';

const UG = 'μg/m³';

// Open-Meteo `current` values, shaped like a live response (Willingboro, NJ, 2026-10-09)
const CURRENT = {
  time: Date.parse('2026-10-09T15:00:00Z') / 1000,
  interval: 3600,
  us_aqi: 55,
  european_aqi: 31,
  uv_index: 4.15,
  pm2_5: 9.5, pm10: 11.0, ozone: 67.0, nitrogen_dioxide: 13.7, sulphur_dioxide: 3.6, carbon_monoxide: 237.0,
  us_aqi_pm2_5: 55, us_aqi_pm10: 11, us_aqi_ozone: 13, us_aqi_nitrogen_dioxide: 7, us_aqi_sulphur_dioxide: 2, us_aqi_carbon_monoxide: 3,
  european_aqi_pm2_5: 31, european_aqi_pm10: 8, european_aqi_ozone: 17, european_aqi_nitrogen_dioxide: 9, european_aqi_sulphur_dioxide: 1,
};

const UNITS = {
  pm2_5: UG, pm10: UG, ozone: UG, nitrogen_dioxide: UG, sulphur_dioxide: UG, carbon_monoxide: UG,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Mocks Open-Meteo Air Quality; `respond(url)` defaults to CURRENT with `overrides` applied.
// Returns the URLs requested.
function mockAirQuality(t, { overrides = {}, respond } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'air-quality-api.open-meteo.com');
    calls.push(u);
    return respond ? respond(u) : json({ current: { ...CURRENT, ...overrides }, current_units: UNITS });
  });
  return calls;
}

test.describe('Air quality API (/api/v1/weather/air)', () => {
  test.beforeEach(() => clearMemoryCache());

  test.it('returns both scales, pollutants and UV index', async (t) => {
    const calls = mockAirQuality(t);

    const response = await supertest(app)
      .get('/api/v1/weather/air/40.04/-74.87')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'public, max-age=900');

    assert.deepStrictEqual(response.body, {
      query: { lat: 40.04, lon: -74.87 },
      source: 'open-meteo',
      time: '2026-10-09T15:00:00.000Z',
      aqi: {
        us: { value: 55, category: 'moderate', dominant: 'pm2_5' },
        eu: { value: 31, category: 'fair', dominant: 'pm2_5' },
      },
      pollutants: {
        pm2_5: { value: 9.5, unit: UG, usAqi: 55, euAqi: 31 },
        pm10: { value: 11, unit: UG, usAqi: 11, euAqi: 8 },
        ozone: { value: 67, unit: UG, usAqi: 13, euAqi: 17 },
        no2: { value: 13.7, unit: UG, usAqi: 7, euAqi: 9 },
        so2: { value: 3.6, unit: UG, usAqi: 2, euAqi: 1 },
        co: { value: 237, unit: UG, usAqi: 3, euAqi: null },
      },
      uvIndex: 4.2,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('latitude'), '40.04');
    assert.equal(calls[0].searchParams.get('longitude'), '-74.87');
    assert.match(calls[0].searchParams.get('current'), /european_aqi_nitrogen_dioxide/);
    assert.doesNotMatch(calls[0].searchParams.get('current'), /european_aqi_carbon_monoxide/);
  });

  test.it('names the dominant pollutant per scale, never CO on the EU scale', async (t) => {
    mockAirQuality(t, {
      overrides: {
        us_aqi: 120, us_aqi_carbon_monoxide: 120, us_aqi_pm2_5: 60,
        european_aqi: 45, european_aqi_nitrogen_dioxide: 45, european_aqi_pm2_5: 30,
      },
    });

    const { body } = await supertest(app).get('/api/v1/weather/air/48.85/2.35').expect(200);
    assert.deepStrictEqual(body.aqi.us, { value: 120, category: 'unhealthy_sensitive', dominant: 'co' });
    assert.deepStrictEqual(body.aqi.eu, { value: 45, category: 'moderate', dominant: 'no2' });
  });

  test.it('breaks dominant ties by pollutant order', async (t) => {
    mockAirQuality(t, { overrides: { us_aqi_pm2_5: 40, us_aqi_ozone: 55, us_aqi_pm10: 55 } });

    const { body } = await supertest(app).get('/api/v1/weather/air/40/-74').expect(200);
    assert.equal(body.aqi.us.dominant, 'pm10');
  });

  test.it('returns null for a scale, pollutant or UV index the source has no value for', async (t) => {
    mockAirQuality(t, { overrides: { european_aqi: null, pm10: null, uv_index: null } });

    const { body } = await supertest(app).get('/api/v1/weather/air/40/-74').expect(200);
    assert.equal(body.aqi.eu, null);
    assert.equal(body.aqi.us.value, 55);
    assert.equal(body.pollutants.pm10, null);
    assert.equal(body.uvIndex, null);
  });

  test.it('returns null dominant when no sub-indices are available', async (t) => {
    const noSubIndices = Object.fromEntries(Object.keys(CURRENT)
      .filter(k => /^(us|european)_aqi_/.test(k)).map(k => [k, null]));
    mockAirQuality(t, { overrides: noSubIndices });

    const { body } = await supertest(app).get('/api/v1/weather/air/40/-74').expect(200);
    assert.equal(body.aqi.us.dominant, null);
    assert.equal(body.aqi.eu.dominant, null);
  });

  test.it('shares a cache entry for nearby coordinates', async (t) => {
    const calls = mockAirQuality(t);

    await supertest(app).get('/api/v1/weather/air/40.041/-74.871').expect(200);
    await supertest(app).get('/api/v1/weather/air/40.044/-74.868').expect(200);
    assert.equal(calls.length, 1);
  });

  test.it('returns 502 when Open-Meteo returns an error', async (t) => {
    mockAirQuality(t, { respond: () => json({ error: true, reason: 'boom' }, 500) });

    const { body } = await supertest(app).get('/api/v1/weather/air/40/-74').expect(502);
    assert.deepStrictEqual(body, { status: 'error', message: 'Air quality provider returned 500.' });
  });

  test.it('returns 502 when Open-Meteo cannot be reached', async (t) => {
    mockAirQuality(t, { respond: () => { throw new TypeError('fetch failed'); } });

    const { body } = await supertest(app).get('/api/v1/weather/air/40/-74').expect(502);
    assert.equal(body.message, 'Air quality provider could not be reached.');
  });

  test.it('returns 400 for invalid coordinates', async () => {
    const { body: latBody } = await supertest(app).get('/api/v1/weather/air/91/-74').expect(400);
    assert.equal(latBody.message, 'Invalid parameter: "lat" must be a number between -90 and 90.');

    const { body: lonBody } = await supertest(app).get('/api/v1/weather/air/40/abc').expect(400);
    assert.equal(lonBody.message, 'Invalid parameter: "lon" must be a number between -180 and 180.');
  });
});

test.describe('AQI categories', () => {
  test.it('uses the EPA bands for the US scale', () => {
    const cases = [
      [0, 'good'], [50, 'good'], [51, 'moderate'], [100, 'moderate'], [101, 'unhealthy_sensitive'],
      [150, 'unhealthy_sensitive'], [151, 'unhealthy'], [200, 'unhealthy'], [201, 'very_unhealthy'],
      [300, 'very_unhealthy'], [301, 'hazardous'], [500, 'hazardous'],
    ];
    for (const [value, category] of cases) assert.equal(usCategory(value), category, `US ${value}`);
  });

  test.it('uses the Open-Meteo bands for the European scale', () => {
    const cases = [
      [0, 'good'], [20, 'good'], [21, 'fair'], [40, 'fair'], [41, 'moderate'], [60, 'moderate'],
      [61, 'poor'], [80, 'poor'], [81, 'very_poor'], [100, 'very_poor'], [101, 'extremely_poor'],
    ];
    for (const [value, category] of cases) assert.equal(euCategory(value), category, `EU ${value}`);
  });
});
