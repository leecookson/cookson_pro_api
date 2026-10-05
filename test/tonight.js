import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';
import { clearMemoryCache } from '../lib/common/cache.js';

// ISS element set with epoch 2026-10-05T01:07Z (from live.ariss.org/iss.txt)
const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26278.04655461  .00004924  00000-0  98343-4 0  9996',
  '2 25544  51.6316 116.4131 0006856 223.9771 136.0673 15.48738655588781',
].join('\n');

// Open-Meteo hourly response covering local hours of `date` and the next date
function cloudsResponse({ startUtcMs, hours = 48, cover = (i) => i % 100 }) {
  const time = Array.from({ length: hours }, (_, i) => (startUtcMs + i * 3600000) / 1000);
  const values = time.map((_, i) => cover(i));
  const body = {
    hourly: {
      time,
      cloud_cover: values,
      cloud_cover_low: values,
      cloud_cover_mid: time.map(() => 0),
      cloud_cover_high: time.map(() => 0),
      visibility: time.map(() => 20000),
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// Route fetches by host: Open-Meteo gets `clouds`, everything else (the ISS TLE sources) gets `tle`.
// Returns the URLs requested from each.
function mockUpstreams(t, { clouds = () => cloudsResponse({ startUtcMs: 0 }), tle = () => new Response(ISS_TLE) } = {}) {
  const calls = { clouds: [], tle: [] };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.open-meteo.com') {
      calls.clouds.push(u);
      return clouds(u);
    }
    calls.tle.push(u);
    return tle(u);
  });
  return calls;
}

function mockOpenMeteo(t, options) {
  return mockUpstreams(t, { clouds: () => cloudsResponse(options) }).clouds;
}

// 2026-10-05T00:00:00-07:00
const LA_MIDNIGHT = Date.parse('2026-10-05T07:00:00Z');
// 2026-10-08T00:00:00+11:00
const SYDNEY_MIDNIGHT = Date.parse('2026-10-07T13:00:00Z');

test.describe('Tonight API (/api/v1/astro/tonight)', () => {
  // TLE and forecasts are cached in memory between requests
  test.beforeEach(() => clearMemoryCache());

  test.it('should return sun/moon, the viewing window and hourly clouds', async (t) => {
    const calls = mockOpenMeteo(t, { startUtcMs: LA_MIDNIGHT, cover: (i) => i });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/37.77/-122.42')
      .query({ date: '2026-10-05', tz: 'America/Los_Angeles' })
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'public, max-age=60');

    const { query, window, sun, moon, clouds, unavailable } = response.body;
    assert.deepStrictEqual(query, { lat: 37.77, lon: -122.42, date: '2026-10-05', tz: 'America/Los_Angeles' });
    assert.ok(sun.set && moon.phase, 'sun and moon sections should match /sunmoon');
    assert.strictEqual(response.body.status, 'ok');
    assert.strictEqual(response.body.reason, undefined);
    assert.deepStrictEqual(unavailable, {});

    // Window is sunset + 1 hour to local midnight
    assert.strictEqual(Date.parse(window.start) - Date.parse(sun.set), 3600000);
    assert.strictEqual(window.end, '2026-10-06T00:00:00-07:00');

    // Upstream asked for the local date and the next (for the midnight sample)
    const params = calls[0].searchParams;
    assert.strictEqual(calls[0].origin + calls[0].pathname, 'https://api.open-meteo.com/v1/forecast');
    assert.strictEqual(params.get('start_date'), '2026-10-05');
    assert.strictEqual(params.get('end_date'), '2026-10-06');
    assert.strictEqual(params.get('timezone'), 'America/Los_Angeles');

    // Sunset is ~18:46, so the window opens ~19:46: samples 19:00 (covers the opening) through 00:00
    assert.strictEqual(clouds.source, 'open-meteo');
    assert.deepStrictEqual(clouds.hourly.map(h => h.time.slice(11, 16)), ['19:00', '20:00', '21:00', '22:00', '23:00', '00:00']);
    assert.deepStrictEqual(clouds.hourly[0], { time: '2026-10-05T19:00:00-07:00', cover: 19, low: 19, mid: 0, high: 0, visibilityMeters: 20000 });
    // 19..24% varies by only 5 points, so there is no meaningful clearest hour
    assert.deepStrictEqual(clouds.summary, {
      sky: 'partly_cloudy',
      steady: true,
      meanCover: 22,
      minCover: 19,
      maxCover: 24,
      clearest: null,
    });
  });

  // Window for this date/location is ~19:46 to 00:00; hourly index i is local hour i
  const summaryCases = [
    ['clear all evening', () => 0, { sky: 'clear', steady: true, clearest: null }],
    ['cloudy all evening', (i) => 85 + (i % 3) * 7, { sky: 'cloudy', steady: true, clearest: null }],
    ['clearing after 21:00', (i) => (i >= 21 ? 10 : 90), { sky: 'partly_cloudy', steady: false, clearest: { time: '2026-10-05T21:00:00-07:00', cover: 10 } }],
    // Lead-in 19:00 sample is clearest; report the window opening, not a time before it
    ['clearest at the window opening', (i) => (i === 19 ? 5 : 60), { sky: 'mostly_cloudy', steady: false, clearest: { time: '2026-10-05T19:46:00-07:00', cover: 5 } }],
  ];

  for (const [label, cover, expected] of summaryCases) {
    test.it(`should summarize clouds: ${label}`, async (t) => {
      mockOpenMeteo(t, { startUtcMs: LA_MIDNIGHT, cover });

      const response = await supertest(app)
        .get('/api/v1/astro/tonight/37.77/-122.42')
        .query({ date: '2026-10-05', tz: 'America/Los_Angeles' })
        .expect(200);

      const { summary } = response.body.clouds;
      assert.strictEqual(response.body.window.start, '2026-10-05T19:46:00-07:00');
      assert.deepStrictEqual({ sky: summary.sky, steady: summary.steady, clearest: summary.clearest }, expected);
    });
  }

  test.it('should report clouds and ISS unavailable for a date beyond their range', async (t) => {
    mockUpstreams(t, {
      clouds: () => new Response(
        JSON.stringify({ error: true, reason: "Parameter 'start_date' is out of allowed range from 2026-07-04 to 2026-10-20" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/37.77/-122.42')
      .query({ date: '2027-01-05', tz: 'America/Los_Angeles' })
      .expect(200);

    assert.strictEqual(response.body.status, 'ok');
    assert.strictEqual(response.body.clouds, null);
    assert.deepStrictEqual(response.body.objects, []);
    assert.deepStrictEqual(response.body.unavailable, {
      'clouds': 'Cloud forecast is not available for this date.',
      'objects.iss': 'ISS pass predictions are only available for a few days around today.',
    });
    assert.ok(response.body.window && response.body.sun.set, 'other sections should still be filled');
  });

  test.it('should return clouds null with a reason when the provider is unreachable', async (t) => {
    mockUpstreams(t, { clouds: () => { throw new TypeError('fetch failed'); } });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/37.77/-122.42')
      .query({ date: '2026-10-05', tz: 'America/Los_Angeles' })
      .expect(200);

    assert.strictEqual(response.body.clouds, null);
    assert.deepStrictEqual(response.body.unavailable, { clouds: 'Cloud forecast provider could not be reached.' });
  });

  // --- ISS ---

  test.it('should list visible ISS passes in the window', async (t) => {
    mockUpstreams(t, { clouds: () => cloudsResponse({ startUtcMs: SYDNEY_MIDNIGHT }) });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/-33.87/151.21')
      .query({ date: '2026-10-08', tz: 'Australia/Sydney' })
      .expect(200);

    const { window, objects, unavailable } = response.body;
    assert.deepStrictEqual(unavailable, {});
    assert.strictEqual(objects.length, 1);
    const [iss] = objects;
    assert.deepStrictEqual({ id: iss.id, name: iss.name, kind: iss.kind }, { id: 'iss', name: 'International Space Station', kind: 'satellite' });
    assert.strictEqual(iss.passes.length, 2);

    // First pass is already up when the window opens, so it is clipped to the window start
    assert.deepStrictEqual(iss.passes[0], {
      start: { time: '2026-10-08T20:03:00+11:00', altitude: 35.5, azimuth: 63.9 },
      peak: { time: '2026-10-08T20:03:00+11:00', altitude: 35.5, azimuth: 63.9 },
      end: { time: '2026-10-08T20:04:30+11:00', altitude: 20.1, azimuth: 104.5 },
      durationSeconds: 90,
      endsInShadow: true,
    });
    assert.strictEqual(iss.passes[0].start.time, window.start);

    for (const pass of iss.passes) {
      assert.ok(pass.start.time >= window.start && pass.end.time <= window.end);
      assert.ok(pass.start.altitude >= 10 && pass.peak.altitude >= pass.start.altitude && pass.peak.altitude >= pass.end.altitude);
    }
  });

  test.it('should leave the ISS out of objects when no pass is visible', async (t) => {
    // Evening passes over San Francisco on this date are before sunset
    mockOpenMeteo(t, { startUtcMs: LA_MIDNIGHT });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/37.77/-122.42')
      .query({ date: '2026-10-05', tz: 'America/Los_Angeles' })
      .expect(200);

    assert.deepStrictEqual(response.body.objects, []);
    assert.deepStrictEqual(response.body.unavailable, {});
  });

  test.it('should fall back to the next TLE source and cache the result', async (t) => {
    const calls = mockUpstreams(t, {
      clouds: () => cloudsResponse({ startUtcMs: SYDNEY_MIDNIGHT }),
      tle: (u) => (u.hostname === 'celestrak.org' ? new Response('', { status: 503 }) : new Response(ISS_TLE)),
    });

    for (let i = 0; i < 2; i++) {
      const response = await supertest(app)
        .get('/api/v1/astro/tonight/-33.87/151.21')
        .query({ date: '2026-10-08', tz: 'Australia/Sydney' })
        .expect(200);
      assert.strictEqual(response.body.objects[0].passes.length, 2);
    }

    assert.deepStrictEqual(calls.tle.map(u => u.hostname), ['celestrak.org', 'live.ariss.org']);
  });

  test.it('should report the ISS unavailable when every TLE source fails', async (t) => {
    const calls = mockUpstreams(t, {
      clouds: () => cloudsResponse({ startUtcMs: SYDNEY_MIDNIGHT }),
      tle: () => new Response('', { status: 503 }),
    });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/-33.87/151.21')
      .query({ date: '2026-10-08', tz: 'Australia/Sydney' })
      .expect(200);

    assert.deepStrictEqual(response.body.objects, []);
    assert.deepStrictEqual(response.body.unavailable, { 'objects.iss': 'ISS orbit data could not be retrieved.' });
    assert.ok(response.body.clouds, 'clouds should still be filled');
    assert.strictEqual(calls.tle.length, 3);
  });

  const polar = [
    ['midnight sun', '2026-06-21', 'always_up', 'The sun does not set on this date.'],
    ['polar night', '2026-12-21', 'always_down', 'The sun does not rise or set on this date.'],
  ];

  for (const [label, date, sunPolar, reason] of polar) {
    test.it(`should return status "na" and not call the provider during ${label}`, async (t) => {
      const calls = mockOpenMeteo(t, { startUtcMs: 0 });

      const response = await supertest(app)
        .get('/api/v1/astro/tonight/78.22/15.65')
        .query({ date, tz: 'Arctic/Longyearbyen' })
        .expect(200);

      const body = response.body;
      assert.strictEqual(body.status, 'na');
      assert.strictEqual(body.reason, reason);
      assert.strictEqual(body.window, null);
      assert.strictEqual(body.clouds, null);
      assert.strictEqual(body.objects, null);
      assert.deepStrictEqual(body.unavailable, {});
      assert.strictEqual(body.sun.polar, sunPolar, 'sun and moon are still returned');
      assert.ok(body.moon.phase);
      assert.strictEqual(calls.length, 0);
    });
  }

  test.it('should return 400 for invalid parameters without calling the provider', async (t) => {
    const calls = mockOpenMeteo(t, { startUtcMs: 0 });

    const response = await supertest(app)
      .get('/api/v1/astro/tonight/0/0')
      .query({ tz: 'Mars/Olympus_Mons' })
      .expect(400);

    assert.strictEqual(response.body.message, 'Invalid parameter: unknown "tz" "Mars/Olympus_Mons".');
    assert.strictEqual(calls.length, 0);
  });
});
