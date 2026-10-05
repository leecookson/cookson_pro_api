import * as Astronomy from 'astronomy-engine';
import loggers from 'namespaced-console-logger';
import { ValidationError } from '../common/errors.js';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('service:sunmoon');

const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;

const NEXT_EVENT_LIMIT_DAYS = 2;

const TWILIGHT_ALTITUDES = { civil: -6, nautical: -12, astronomical: -18 };

// astronomy-engine quarter index (0..3) -> API phase name
const QUARTER_NAMES = ['new_moon', 'first_quarter', 'full_moon', 'last_quarter'];

/**
 * Offset of `tz` from UTC at the given instant, in milliseconds.
 */
function getOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in `tz` (e.g. local midnight or noon).
 */
function zonedTimeToUtc(year, month, day, hour, tz) {
  const guess = Date.UTC(year, month - 1, day, hour);
  let t = guess - getOffsetMs(new Date(guess), tz);
  // Re-check in case the offset differs at the corrected instant (DST transition day)
  t = guess - getOffsetMs(new Date(t), tz);
  return new Date(t);
}

/**
 * ISO 8601 string with the offset of `tz`, e.g. 2026-10-05T07:09:00-07:00
 */
export function formatInZone(date, tz) {
  if (!date) return null;
  const offsetMin = Math.round(getOffsetMs(date, tz) / MS_PER_MINUTE);
  const local = new Date(date.getTime() + offsetMin * MS_PER_MINUTE);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

function todayInZone(tz) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function roundToMinute(date) {
  return date ? new Date(Math.round(date.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE) : null;
}

// astronomy-engine returns AstroTime or null; keep only events inside [start, end)
function toDateInRange(astroTime, start, end) {
  if (!astroTime) return null;
  const d = astroTime.date;
  return d >= start && d < end ? roundToMinute(d) : null;
}

/**
 * UTC instants bounding the local calendar day in `tz`: midnight, noon, and the next midnight.
 * A DST transition day is 23 or 25 hours long.
 */
export function localDay({ year, month, day, tz }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: zonedTimeToUtc(year, month, day, 0, tz),
    noon: zonedTimeToUtc(year, month, day, 12, tz),
    end: zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, tz),
  };
}

/**
 * Validates lat/lon/date/tz and fills defaults (tz = UTC, date = today in tz).
 * Shared by every endpoint that takes a location and a local date.
 */
export function validateQuery({ lat, lon, date, tz }) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (lat === undefined || lat === '' || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
    throw new ValidationError('Invalid parameter: "lat" must be a number between -90 and 90.');
  }
  if (lon === undefined || lon === '' || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
    throw new ValidationError('Invalid parameter: "lon" must be a number between -180 and 180.');
  }

  const zone = tz || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new ValidationError(`Invalid parameter: unknown "tz" "${zone}".`);
  }

  const localDate = date || todayInZone(zone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new ValidationError('Invalid parameter: "date" must be in YYYY-MM-DD format.');
  }
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ValidationError('Invalid parameter: "date" is not a valid calendar date.');
  }

  return { lat: latNum, lon: lonNum, date: localDate, tz: zone, year, month, day };
}

class SunMoonService {
  /**
   * Rise/set/transit/twilight for the sun, and rise/set/transit/phase for the moon,
   * for the local calendar date `date` in IANA zone `tz`.
   * `position`, `nextRise` and `nextSet` are relative to `now` (the time of the request).
   */
  getSunMoon(params = {}, now = new Date()) {
    const q = validateQuery(params);
    const { lat, lon, tz } = q;
    logger.info(`Computing sun/moon for ${JSON.stringify({ lat, lon, date: q.date, tz })}`);

    const observer = new Astronomy.Observer(lat, lon, 0);

    const { start, end, noon } = localDay(q);
    const dayDays = (end - start) / MS_PER_DAY;

    const riseSet = (body, direction) =>
      toDateInRange(Astronomy.SearchRiseSet(body, observer, direction, start, dayDays), start, end);
    const transit = (body) =>
      toDateInRange(Astronomy.SearchHourAngle(body, observer, 0, start, +1).time, start, end);

    const sun = this.#sun(observer, start, end, dayDays, riseSet, transit);
    const moon = this.#moon(start, end, dayDays, noon, riseSet, transit);
    const sunNow = this.#now(Astronomy.Body.Sun, observer, now);
    const moonNow = this.#now(Astronomy.Body.Moon, observer, now);

    const fmt = (d) => formatInZone(d, tz);
    return {
      query: { lat, lon, date: q.date, tz },
      sun: {
        rise: fmt(sun.rise),
        set: fmt(sun.set),
        transit: fmt(sun.transit),
        dayLengthSeconds: sun.dayLengthSeconds,
        polar: sun.polar,
        position: sunNow.position,
        nextRise: fmt(sunNow.nextRise),
        nextSet: fmt(sunNow.nextSet),
        twilight: Object.fromEntries(Object.entries(sun.twilight).map(([k, v]) => [k, { begin: fmt(v.begin), end: fmt(v.end) }])),
      },
      moon: {
        rise: fmt(moon.rise),
        set: fmt(moon.set),
        transit: fmt(moon.transit),
        position: moonNow.position,
        nextRise: fmt(moonNow.nextRise),
        nextSet: fmt(moonNow.nextSet),
        phase: moon.phase,
        next: moon.next.map(({ name, time }) => ({ name, time: fmt(time) })),
      },
    };
  }

  // Topocentric position at `now` (altitude with refraction), and the next rise/set within 2 days
  #now(body, observer, now) {
    const eq = Astronomy.Equator(body, now, observer, true, true);
    const hor = Astronomy.Horizon(now, observer, eq.ra, eq.dec, 'normal');
    const next = (direction) => {
      const t = Astronomy.SearchRiseSet(body, observer, direction, now, NEXT_EVENT_LIMIT_DAYS);
      return t ? roundToMinute(t.date) : null;
    };
    return {
      position: { altitude: round(hor.altitude, 1), azimuth: round(hor.azimuth, 1) },
      nextRise: next(+1),
      nextSet: next(-1),
    };
  }

  #sun(observer, start, end, dayDays, riseSet, transit) {
    const rise = riseSet(Astronomy.Body.Sun, +1);
    const set = riseSet(Astronomy.Body.Sun, -1);
    const transitTime = transit(Astronomy.Body.Sun);

    let polar = null;
    let dayLengthSeconds;
    if (!rise && !set) {
      // No horizon crossing all day: up or down depends on altitude at transit
      const at = transitTime || new Date((start.getTime() + end.getTime()) / 2);
      const eq = Astronomy.Equator(Astronomy.Body.Sun, at, observer, true, true);
      const hor = Astronomy.Horizon(at, observer, eq.ra, eq.dec, 'normal');
      polar = hor.altitude > -0.833 ? 'always_up' : 'always_down';
      dayLengthSeconds = polar === 'always_up' ? 86400 : 0;
    } else {
      // Sum the time above the horizon within the local day
      let upMs;
      if (rise && set) upMs = rise < set ? set - rise : (set - start) + (end - rise);
      else if (rise) upMs = end - rise;
      else upMs = set - start;
      dayLengthSeconds = Math.round(upMs / 1000);
    }

    const twilight = {};
    for (const [name, altitude] of Object.entries(TWILIGHT_ALTITUDES)) {
      twilight[name] = {
        begin: toDateInRange(Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, +1, start, dayDays, altitude), start, end),
        end: toDateInRange(Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, start, dayDays, altitude), start, end),
      };
    }

    return { rise, set, transit: transitTime, dayLengthSeconds, polar, twilight };
  }

  #moon(start, end, dayDays, noon, riseSet, transit) {
    const rise = riseSet(Astronomy.Body.Moon, +1);
    const set = riseSet(Astronomy.Body.Moon, -1);
    const transitTime = transit(Astronomy.Body.Moon);

    // Phase values at local noon
    const longitude = Astronomy.MoonPhase(noon); // 0..360, 0 = new
    const fraction = longitude / 360;
    const illumination = Astronomy.Illumination(Astronomy.Body.Moon, noon).phase_fraction;

    // Age: time since the most recent new moon before noon
    const approxAgeDays = fraction * 29.530588;
    const lastNew = Astronomy.SearchMoonPhase(0, new Date(noon.getTime() - (approxAgeDays + 2) * MS_PER_DAY), approxAgeDays + 2);
    const ageDays = lastNew ? (noon - lastNew.date) / MS_PER_DAY : approxAgeDays;

    // A principal phase name applies when that instant falls on this local date;
    // otherwise use the intermediate phase for the position in the cycle.
    let name = null;
    for (let quarter = 0; quarter < 4; quarter++) {
      if (toDateInRange(Astronomy.SearchMoonPhase(quarter * 90, start, dayDays), start, end)) {
        name = QUARTER_NAMES[quarter];
        break;
      }
    }
    if (!name) {
      if (fraction < 0.25) name = 'waxing_crescent';
      else if (fraction < 0.5) name = 'waxing_gibbous';
      else if (fraction < 0.75) name = 'waning_gibbous';
      else name = 'waning_crescent';
    }

    const nextQuarters = [];
    let mq = Astronomy.SearchMoonQuarter(noon);
    for (let i = 0; i < 2; i++) {
      nextQuarters.push({ name: QUARTER_NAMES[mq.quarter], time: roundToMinute(mq.time.date) });
      mq = Astronomy.NextMoonQuarter(mq);
    }

    return {
      rise,
      set,
      transit: transitTime,
      phase: {
        name,
        illumination: round(illumination, 2),
        ageDays: round(ageDays, 1),
        fraction: round(fraction, 2),
      },
      next: nextQuarters,
    };
  }
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export default new SunMoonService();
