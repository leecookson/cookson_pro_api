import loggers from 'namespaced-console-logger';
import { SourceUnavailableError } from '../common/errors.js';
import { cached } from '../common/cache.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:people');

// Launch Library 2: authoritative for who is in space (updated at each launch and landing),
// but has no current station, spacecraft or crew role. The free tier allows ~15 requests
// an hour, so it must only be reached through the cache.
const LL2_URL = 'https://ll.thespacedevs.com/2.3.0/astronauts/?in_space=true&limit=50&mode=detailed';
// Community-maintained JSON with station, spacecraft and role. Hand-updated, so it can lag
// behind a landing; its days_in_space is not reliable and is ignored.
const CORQUAID_URL = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';
// Open Notify (api.open-notify.org/astros.json) is not used: its crew list stopped updating in 2024.

const TIMEOUT_MS = 10000;
// Crews change a few times a month at most
const FRESH_MS = 3600000;
const MAX_STALE_MS = 24 * 3600000;
const MS_PER_DAY = 86400000;

const STATION_ORDER = ['ISS', 'Tiangong'];

// Lowercase, no accents or punctuation, for matching names across sources
const nameKey = (name) => name.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Station from a spacecraft or mission name, for people the station isn't known for
export function stationForCraft(craft) {
  if (!craft) return null;
  if (/^shenzhou/i.test(craft)) return 'Tiangong';
  if (/^(soyuz|crew-|ax-|axiom|starliner|boe-)/i.test(craft)) return 'ISS';
  return null;
}

async function fetchJson(url, label) {
  logger.info(`Calling external API: ${url}`);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    logger.error(`Error calling ${label}: ${error.message}`);
    throw new SourceUnavailableError(`${label} could not be reached.`);
  }
  if (!response.ok) {
    logger.warn(`${label} error: ${response.status} ${response.statusText}`);
    throw new SourceUnavailableError(response.status === 429
      ? `${label} rate limit reached.`
      : `${label} returned ${response.status}.`);
  }
  return response.json();
}

// LL2 astronauts reduced to what we use (the full response is ~500 KB, too big to cache)
async function loadLaunchLibrary() {
  const { results = [] } = await fetchJson(LL2_URL, 'Launch Library 2');
  return results
    .filter((a) => a.type?.name !== 'Non-Human') // e.g. Starman, the mannequin in the Tesla
    .map((a) => {
      // `last_flight` is the launch time of the current flight; `flights` is not in date order
      const current = (a.flights ?? []).find((f) => f.net === a.last_flight);
      return {
        name: a.name,
        agency: a.agency?.abbrev ?? null,
        country: a.nationality?.[0]?.name ?? null,
        countryCode: a.nationality?.[0]?.alpha_2_code ?? null,
        // Launch names read "Falcon 9 Block 5 | Crew-13"; keep the mission
        mission: current?.name?.split(' | ').pop() ?? null,
        launched: a.last_flight ?? null,
        image: a.image?.thumbnail_url ?? null,
        wiki: a.wiki || null,
      };
    });
}

async function loadCorquaid() {
  const { people = [] } = await fetchJson(CORQUAID_URL, 'People in space feed');
  return people.map((p) => ({
    name: p.name,
    agency: p.agency || null,
    country: p.country || null,
    countryCode: p.flag_code ? p.flag_code.toUpperCase() : null,
    spacecraft: p.spacecraft || null,
    station: p.iss ? 'ISS' : stationForCraft(p.spacecraft),
    role: p.position || null,
    launched: Number.isFinite(p.launched) ? new Date(p.launched * 1000).toISOString() : null,
    image: p.image || null,
    wiki: p.url || null,
  }));
}

// Loads one source through the cache; a failure becomes { error } instead of a throw
async function load(key, loader) {
  try {
    return { people: await cached(key, { freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS }, loader) };
  } catch (error) {
    if (error instanceof SourceUnavailableError) return { error: error.message };
    throw error;
  }
}

const stationRank = (station) => {
  const i = STATION_ORDER.indexOf(station);
  return i === -1 ? STATION_ORDER.length : i;
};

// Within a crew: commander, then pilot, then everyone else
const roleRank = (role) => (/commander/i.test(role ?? '') ? 0 : /pilot/i.test(role ?? '') ? 1 : 2);

class PeopleService {
  /**
   * Everyone in space now, from Launch Library 2 (who) enriched by the corquaid feed (where,
   * on what, in which role). If one source fails the other is used alone, and the failure is
   * reported under `unavailable`. Throws SourceUnavailableError only if both fail.
   * See docs/api-space-people.md.
   */
  async getPeopleInSpace(now = new Date()) {
    const [ll2, corquaid] = await Promise.all([
      load('people:ll2', loadLaunchLibrary),
      load('people:corquaid', loadCorquaid),
    ]);

    if (ll2.error && corquaid.error) {
      throw new SourceUnavailableError('People in space sources are unavailable.');
    }

    const details = new Map((corquaid.people ?? []).map((p) => [nameKey(p.name), p]));

    let people;
    if (ll2.people) {
      // LL2 decides who is up; anyone only in the hand-maintained feed has probably landed
      people = ll2.people.map((a) => {
        const d = details.get(nameKey(a.name));
        const spacecraft = d?.spacecraft ?? a.mission;
        return {
          name: a.name,
          agency: d?.agency ?? a.agency,
          country: d?.country ?? a.country,
          countryCode: d?.countryCode ?? a.countryCode,
          spacecraft,
          station: d?.station ?? stationForCraft(spacecraft),
          role: d?.role ?? null,
          launched: a.launched ?? d?.launched ?? null,
          image: a.image ?? d?.image ?? null,
          wiki: a.wiki ?? d?.wiki ?? null,
        };
      });
      const dropped = [...details.keys()].filter((k) => !ll2.people.some((a) => nameKey(a.name) === k));
      if (dropped.length) logger.info(`Not in space per Launch Library 2, ignoring: ${dropped.join(', ')}`);
    } else {
      people = corquaid.people.map((p) => ({ ...p }));
    }

    for (const p of people) {
      p.daysInSpace = p.launched ? Math.max(0, Math.floor((now - new Date(p.launched)) / MS_PER_DAY)) : null;
    }

    people.sort((a, b) => stationRank(a.station) - stationRank(b.station)
      || (a.launched ?? '').localeCompare(b.launched ?? '')
      || roleRank(a.role) - roleRank(b.role)
      || a.name.localeCompare(b.name));

    const counts = new Map();
    for (const p of people) counts.set(p.station, (counts.get(p.station) ?? 0) + 1);
    const stations = [...counts].map(([name, count]) => ({ name, count }));

    const unavailable = {};
    if (ll2.error) unavailable.launchLibrary2 = ll2.error;
    if (corquaid.error) unavailable.corquaid = corquaid.error;

    return {
      sources: [ll2.people && 'launch-library-2', corquaid.people && 'corquaid'].filter(Boolean),
      count: people.length,
      stations,
      people,
      unavailable,
    };
  }
}

export default new PeopleService();
