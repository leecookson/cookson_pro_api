import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import app from '../lib/app.js';
import { clearMemoryCache } from '../lib/common/cache.js';
import peopleService, { stationForCraft } from '../lib/service/people.js';

const NOW = new Date('2026-10-11T12:00:00Z');

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ll2Astronaut = ({ name, agency, country, code, flights, lastFlight, type = 'Government' }) => ({
  name,
  type: { name: type },
  agency: { abbrev: agency },
  nationality: [{ name: country, alpha_2_code: code }],
  last_flight: lastFlight,
  flights,
  image: { thumbnail_url: `https://img.example/${code}.jpg` },
  wiki: `https://en.wikipedia.org/wiki/${name.replace(/ /g, '_')}`,
});

// LL2 `flights` are deliberately not in date order
const LL2 = {
  results: [
    ll2Astronaut({
      name: 'Pyotr Dubrov', agency: 'RFSA', country: 'Russia', code: 'RU',
      lastFlight: '2026-07-14T14:47:43Z',
      flights: [
        { name: 'Soyuz 2.1a | Soyuz MS-29', net: '2026-07-14T14:47:43Z' },
        { name: 'Soyuz 2.1a | Soyuz MS-18', net: '2021-04-09T07:42:41Z' },
      ],
    }),
    ll2Astronaut({
      name: 'Anil Menon', agency: 'NASA', country: 'United States of America', code: 'US',
      lastFlight: '2026-07-14T14:47:43Z',
      flights: [{ name: 'Soyuz 2.1a | Soyuz MS-29', net: '2026-07-14T14:47:43Z' }],
    }),
    ll2Astronaut({
      name: 'Lai Ka-ying', agency: 'CNSA', country: 'China', code: 'CN',
      lastFlight: '2026-05-24T15:08:36Z',
      flights: [{ name: 'Long March 2F/G | Shenzhou 23', net: '2026-05-24T15:08:36Z' }],
    }),
    // Not in the corquaid feed yet
    ll2Astronaut({
      name: 'Jane Newcrew', agency: 'ESA', country: 'Germany', code: 'DE',
      lastFlight: '2026-10-08T10:00:00Z',
      flights: [{ name: 'Falcon 9 Block 5 | Ax-6', net: '2026-10-08T10:00:00Z' }],
    }),
    ll2Astronaut({
      name: 'Starman', agency: 'SpX', country: 'Unknown', code: 'XX', type: 'Non-Human',
      lastFlight: '2018-02-06T20:45:00Z',
      flights: [{ name: 'Falcon Heavy | Demo (Test Flight)', net: '2018-02-06T20:45:00Z' }],
    }),
  ],
};

const unix = (iso) => Date.parse(iso) / 1000;

const CORQUAID = {
  number: 4,
  people: [
    { name: 'Anil Menon', country: 'United States', flag_code: 'us', agency: 'NASA', position: 'Flight Engineer', spacecraft: 'Soyuz MS-29', launched: unix('2026-07-14T14:47:43Z'), iss: true, days_in_space: 999, image: 'https://img.example/menon.jpg', url: 'https://wiki/menon' },
    { name: 'Pyotr Dubrov', country: 'Russia', flag_code: 'ru', agency: 'Roscosmos', position: 'Commander', spacecraft: 'Soyuz MS-29', launched: unix('2026-07-14T14:47:43Z'), iss: true, days_in_space: 999, image: 'https://img.example/dubrov.jpg', url: 'https://wiki/dubrov' },
    // Different capitalization than LL2
    { name: 'Lai Ka-Ying', country: 'China', flag_code: 'cn', agency: 'CMSA', position: 'Payload Specialist', spacecraft: 'Shenzhou 23', launched: unix('2026-05-24T15:08:36Z'), iss: false, days_in_space: 999, image: 'https://img.example/lai.jpg', url: 'https://wiki/lai' },
    // Landed, but the hand-maintained feed hasn't caught up
    { name: 'Old Crewmember', country: 'Japan', flag_code: 'jp', agency: 'JAXA', position: 'Flight Engineer', spacecraft: 'Crew-12 Dragon', launched: unix('2026-03-01T00:00:00Z'), iss: true, days_in_space: 999, image: null, url: null },
  ],
};

// Mocks both sources by host; each defaults to its fixture. Returns call counts per source.
function mockSources(t, { ll2 = () => json(LL2), corquaid = () => json(CORQUAID) } = {}) {
  const calls = { ll2: 0, corquaid: 0 };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { hostname } = new URL(url);
    if (hostname === 'll.thespacedevs.com') {
      calls.ll2++;
      return ll2();
    }
    assert.equal(hostname, 'corquaid.github.io');
    calls.corquaid++;
    return corquaid();
  });
  return calls;
}

const names = (body) => body.people.map((p) => p.name);

test.describe('People in space service', () => {
  test.beforeEach(() => clearMemoryCache());

  test.it('merges both sources: LL2 decides who, corquaid adds station, spacecraft and role', async (t) => {
    mockSources(t);
    const body = await peopleService.getPeopleInSpace(NOW);

    assert.deepStrictEqual(body.sources, ['launch-library-2', 'corquaid']);
    assert.deepStrictEqual(body.unavailable, {});
    assert.equal(body.count, 4);
    // ISS first, by launch time, commander first within a crew; then Tiangong.
    // Starman (non-human) and the landed crewmember are left out.
    assert.deepStrictEqual(names(body), ['Pyotr Dubrov', 'Anil Menon', 'Jane Newcrew', 'Lai Ka-ying']);
    assert.deepStrictEqual(body.stations, [{ name: 'ISS', count: 3 }, { name: 'Tiangong', count: 1 }]);

    assert.deepStrictEqual(body.people[0], {
      name: 'Pyotr Dubrov',
      agency: 'Roscosmos',
      country: 'Russia',
      countryCode: 'RU',
      spacecraft: 'Soyuz MS-29',
      station: 'ISS',
      role: 'Commander',
      launched: '2026-07-14T14:47:43Z',
      image: 'https://img.example/RU.jpg',
      wiki: 'https://en.wikipedia.org/wiki/Pyotr_Dubrov',
      daysInSpace: 88,
    });
  });

  test.it('matches names across sources regardless of case', async (t) => {
    mockSources(t);
    const body = await peopleService.getPeopleInSpace(NOW);
    const lai = body.people.find((p) => p.name === 'Lai Ka-ying');
    assert.equal(lai.role, 'Payload Specialist');
    assert.equal(lai.station, 'Tiangong');
  });

  test.it('falls back to the LL2 mission for someone not in the corquaid feed', async (t) => {
    mockSources(t);
    const body = await peopleService.getPeopleInSpace(NOW);
    const jane = body.people.find((p) => p.name === 'Jane Newcrew');
    assert.equal(jane.spacecraft, 'Ax-6');
    assert.equal(jane.station, 'ISS');
    assert.equal(jane.role, null);
    assert.equal(jane.agency, 'ESA');
    assert.equal(jane.daysInSpace, 3);
  });

  test.it('uses corquaid alone when LL2 is rate limited', async (t) => {
    mockSources(t, { ll2: () => json({ detail: 'Request was throttled.' }, 429) });
    const body = await peopleService.getPeopleInSpace(NOW);

    assert.deepStrictEqual(body.sources, ['corquaid']);
    assert.deepStrictEqual(body.unavailable, { launchLibrary2: 'Launch Library 2 rate limit reached.' });
    // Without LL2 the landed crewmember can't be ruled out
    assert.equal(body.count, 4);
    assert.ok(names(body).includes('Old Crewmember'));
    // corquaid's own days_in_space is ignored
    assert.equal(body.people.find((p) => p.name === 'Anil Menon').daysInSpace, 88);
  });

  test.it('uses LL2 alone when the corquaid feed fails', async (t) => {
    mockSources(t, { corquaid: () => { throw new TypeError('fetch failed'); } });
    const body = await peopleService.getPeopleInSpace(NOW);

    assert.deepStrictEqual(body.sources, ['launch-library-2']);
    assert.deepStrictEqual(body.unavailable, { corquaid: 'People in space feed could not be reached.' });
    const lai = body.people.find((p) => p.name === 'Lai Ka-ying');
    assert.equal(lai.spacecraft, 'Shenzhou 23');
    assert.equal(lai.station, 'Tiangong');
    assert.equal(lai.role, null);
    assert.equal(lai.agency, 'CNSA');
  });

  test.it('caches each source', async (t) => {
    const calls = mockSources(t);
    await peopleService.getPeopleInSpace(NOW);
    await peopleService.getPeopleInSpace(NOW);
    assert.deepStrictEqual(calls, { ll2: 1, corquaid: 1 });
  });
});

test.describe('People in space API (/api/v1/space/people)', () => {
  test.beforeEach(() => clearMemoryCache());

  test.it('returns 200 with a cache header', async (t) => {
    mockSources(t);
    const response = await supertest(app)
      .get('/api/v1/space/people')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'public, max-age=600');
    assert.equal(response.body.count, 4);
  });

  test.it('returns 502 when both sources fail', async (t) => {
    mockSources(t, {
      ll2: () => json({}, 503),
      corquaid: () => json({}, 404),
    });
    const { body } = await supertest(app).get('/api/v1/space/people').expect(502);
    assert.deepStrictEqual(body, { status: 'error', message: 'People in space sources are unavailable.' });
  });
});

test.describe('stationForCraft', () => {
  test.it('infers the station from the spacecraft or mission name', () => {
    assert.equal(stationForCraft('Shenzhou 23'), 'Tiangong');
    assert.equal(stationForCraft('Soyuz MS-29'), 'ISS');
    assert.equal(stationForCraft('Crew-13 Dragon'), 'ISS');
    assert.equal(stationForCraft('Ax-6'), 'ISS');
    assert.equal(stationForCraft('Polaris Dawn'), null);
    assert.equal(stationForCraft(null), null);
  });
});
