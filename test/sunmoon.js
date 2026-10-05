import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';
import sunMoonService from '../lib/service/sunmoon.js';

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const PHASE_NAMES = ['new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full_moon', 'waning_gibbous', 'last_quarter', 'waning_crescent'];

test.describe('Sun & Moon API (/api/v1/astro/sunmoon)', () => {

  test.it('should return 200 with sun and moon times in the requested zone', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/37.77/-122.42')
      .query({ date: '2026-10-05', tz: 'America/Los_Angeles' })
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'public, max-age=60');

    const { query, sun, moon } = response.body;
    assert.deepStrictEqual(query, { lat: 37.77, lon: -122.42, date: '2026-10-05', tz: 'America/Los_Angeles' });

    assert.strictEqual(sun.polar, null);
    for (const t of [sun.rise, sun.set, sun.transit]) {
      assert.match(t, ISO_WITH_OFFSET);
      assert.ok(t.startsWith('2026-10-05T') && t.endsWith('-07:00'), `${t} should be on the local date in PDT`);
    }
    assert.ok(sun.rise.startsWith('2026-10-05T07:0'), `sunrise ${sun.rise} should be about 07:09`);
    assert.ok(sun.set.startsWith('2026-10-05T18:4'), `sunset ${sun.set} should be about 18:45`);
    assert.ok(Math.abs(sun.dayLengthSeconds - 41700) < 600);

    for (const kind of ['civil', 'nautical', 'astronomical']) {
      assert.match(sun.twilight[kind].begin, ISO_WITH_OFFSET);
      assert.match(sun.twilight[kind].end, ISO_WITH_OFFSET);
    }
    assert.ok(sun.twilight.astronomical.begin < sun.twilight.nautical.begin);
    assert.ok(sun.twilight.nautical.begin < sun.twilight.civil.begin);
    assert.ok(sun.twilight.civil.begin < sun.rise);

    assert.ok(PHASE_NAMES.includes(moon.phase.name));
    assert.ok(moon.phase.illumination >= 0 && moon.phase.illumination <= 1);
    assert.ok(moon.phase.fraction >= 0 && moon.phase.fraction <= 1);
    assert.ok(moon.phase.ageDays >= 0 && moon.phase.ageDays < 30);

    assert.strictEqual(moon.next.length, 2);
    assert.deepStrictEqual(moon.next.map(n => n.name), ['new_moon', 'first_quarter']);
    assert.ok(moon.next[0].time.startsWith('2026-10-10T'), `new moon ${moon.next[0].time} should be on 2026-10-10`);
    assert.ok(moon.next[0].time < moon.next[1].time);
  });

  test.it('should name a principal phase when it occurs on the local date', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/0/0')
      .query({ date: '2026-10-26' })
      .expect(200);

    assert.strictEqual(response.body.query.tz, 'UTC');
    assert.strictEqual(response.body.moon.phase.name, 'full_moon');
    assert.ok(response.body.moon.phase.illumination > 0.98);
  });

  test.it('should report midnight sun with null rise/set', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/78.22/15.65')
      .query({ date: '2026-06-21', tz: 'Arctic/Longyearbyen' })
      .expect(200);

    const { sun } = response.body;
    assert.strictEqual(sun.polar, 'always_up');
    assert.strictEqual(sun.rise, null);
    assert.strictEqual(sun.set, null);
    assert.strictEqual(sun.dayLengthSeconds, 86400);
    assert.deepStrictEqual(sun.twilight.astronomical, { begin: null, end: null });
  });

  test.it('should report polar night with null rise/set', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/78.22/15.65')
      .query({ date: '2026-12-21', tz: 'Arctic/Longyearbyen' })
      .expect(200);

    const { sun } = response.body;
    assert.strictEqual(sun.polar, 'always_down');
    assert.strictEqual(sun.rise, null);
    assert.strictEqual(sun.set, null);
    assert.strictEqual(sun.dayLengthSeconds, 0);
  });

  test.it('should use the post-transition offset on a DST change day', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/40.05/-74.84')
      .query({ date: '2026-03-08', tz: 'America/New_York' })
      .expect(200);

    assert.ok(response.body.sun.rise.endsWith('-04:00'));
    assert.ok(response.body.sun.twilight.astronomical.begin.endsWith('-04:00'));
  });

  test.it('should default date to today in tz', async () => {
    const tz = 'Pacific/Auckland';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/-36.85/174.76')
      .query({ tz })
      .expect(200);

    assert.strictEqual(response.body.query.date, today);
  });

  test.it('should include position, nextRise and nextSet relative to the request time', async () => {
    const response = await supertest(app)
      .get('/api/v1/astro/sunmoon/37.77/-122.42')
      .query({ tz: 'America/Los_Angeles' })
      .expect(200);

    const now = Date.now();
    for (const body of [response.body.sun, response.body.moon]) {
      assert.ok(body.position.altitude >= -90 && body.position.altitude <= 90);
      assert.ok(body.position.azimuth >= 0 && body.position.azimuth < 360);
      for (const t of [body.nextRise, body.nextSet]) {
        assert.match(t, ISO_WITH_OFFSET);
        // Rounded to the minute, so allow 30s before now; within the 2-day search limit
        assert.ok(Date.parse(t) > now - 30000 && Date.parse(t) < now + 2 * 86400000, `${t} should be in the next 2 days`);
      }
    }
  });

  test.it('should compute position and next events at a given time', () => {
    // 2026-10-05 14:30 PDT, the time used for the spec example
    const now = new Date('2026-10-05T21:30:00Z');
    const { sun, moon } = sunMoonService.getSunMoon({ lat: '37.77', lon: '-122.42', date: '2026-10-05', tz: 'America/Los_Angeles' }, now);

    // Sun peaks at ~47° (90 - 37.77 - 5° declination) at 12:57; 1.5 h later it is a little lower, in the south-west.
    // Moon (rose ~01:40, sets ~16:16) is still up in the west.
    assert.ok(sun.position.altitude > 38 && sun.position.altitude < 46, `sun altitude ${sun.position.altitude}`);
    assert.ok(sun.position.azimuth > 200 && sun.position.azimuth < 250, `sun azimuth ${sun.position.azimuth}`);
    assert.ok(moon.position.altitude > 0, `moon altitude ${moon.position.altitude}`);
    assert.ok(moon.position.azimuth > 180 && moon.position.azimuth < 300, `moon azimuth ${moon.position.azimuth}`);

    // Next set is today's; next rise is tomorrow's
    assert.strictEqual(sun.nextSet, sun.set);
    assert.ok(sun.nextRise.startsWith('2026-10-06T07:'), `next sunrise ${sun.nextRise}`);
    assert.strictEqual(moon.nextSet, moon.set);
    assert.ok(moon.nextRise.startsWith('2026-10-06T0'), `next moonrise ${moon.nextRise}`);
  });

  test.it('should return null nextRise/nextSet during polar night', () => {
    const now = new Date('2026-12-21T12:00:00Z');
    const { sun } = sunMoonService.getSunMoon({ lat: 78.22, lon: 15.65, date: '2026-12-21', tz: 'Arctic/Longyearbyen' }, now);

    assert.strictEqual(sun.nextRise, null);
    assert.strictEqual(sun.nextSet, null);
    assert.ok(sun.position.altitude < 0);
  });

  // --- Parameter Validation Tests ---

  const invalid = [
    ['lat out of range', '/api/v1/astro/sunmoon/91/0', {}, 'Invalid parameter: "lat" must be a number between -90 and 90.'],
    ['non-numeric lat', '/api/v1/astro/sunmoon/abc/0', {}, 'Invalid parameter: "lat" must be a number between -90 and 90.'],
    ['lon out of range', '/api/v1/astro/sunmoon/0/-181', {}, 'Invalid parameter: "lon" must be a number between -180 and 180.'],
    ['malformed date', '/api/v1/astro/sunmoon/0/0', { date: '10/05/2026' }, 'Invalid parameter: "date" must be in YYYY-MM-DD format.'],
    ['impossible date', '/api/v1/astro/sunmoon/0/0', { date: '2026-02-30' }, 'Invalid parameter: "date" is not a valid calendar date.'],
    ['unknown tz', '/api/v1/astro/sunmoon/0/0', { tz: 'Mars/Olympus_Mons' }, 'Invalid parameter: unknown "tz" "Mars/Olympus_Mons".'],
  ];

  for (const [label, url, query, message] of invalid) {
    test.it(`should return 400 for ${label}`, async () => {
      const response = await supertest(app).get(url).query(query).expect(400);
      assert.strictEqual(response.body.message, message);
    });
  }
});
