import * as Astronomy from 'astronomy-engine';

// Naked-eye planets, in order out from the sun
const PLANETS = [
  { id: 'venus', name: 'Venus', body: Astronomy.Body.Venus },
  { id: 'mars', name: 'Mars', body: Astronomy.Body.Mars },
  { id: 'jupiter', name: 'Jupiter', body: Astronomy.Body.Jupiter },
  { id: 'saturn', name: 'Saturn', body: Astronomy.Body.Saturn },
];

// Same threshold as ISS passes: lower than this is usually lost in haze or behind the horizon
const MIN_ALTITUDE_DEG = 10;
const STEP_MS = 60000;

const round = (value) => Math.round(value * 10) / 10;

class PlanetsService {
  /**
   * Naked-eye planets that are at least MIN_ALTITUDE_DEG above the horizon at some point
   * between `start` and `end` (Dates) for an observer at lat/lon.
   * Returns [{ id, name, start, peak, end, magnitude, constellation }], where start/peak/end are
   * { time: Date, altitude, azimuth } in degrees, clipped to [start, end]. A planet that dips
   * below the threshold and comes back within the window is reported from first to last time up.
   */
  getVisiblePlanets({ lat, lon, start, end }) {
    const observer = new Astronomy.Observer(lat, lon, 0);
    return PLANETS
      .map(planet => this.#visibility(planet, observer, start, end))
      .filter(Boolean);
  }

  #visibility({ id, name, body }, observer, start, end) {
    let first = null;
    let last = null;
    let peak = null;

    for (let t = start.getTime(); t <= end.getTime(); t += STEP_MS) {
      const time = new Date(t);
      const eq = Astronomy.Equator(body, time, observer, true, true);
      const { altitude, azimuth } = Astronomy.Horizon(time, observer, eq.ra, eq.dec, 'normal');
      if (altitude < MIN_ALTITUDE_DEG) continue;

      const sample = { time, altitude, azimuth };
      if (!first) first = sample;
      if (!peak || altitude > peak.altitude) peak = sample;
      last = sample;
    }
    if (!peak) return null;

    // Constellation boundaries are defined in J2000 coordinates
    const j2000 = Astronomy.Equator(body, peak.time, observer, false, true);
    const point = (s) => ({ time: s.time, altitude: round(s.altitude), azimuth: round(s.azimuth) });
    return {
      id,
      name,
      start: point(first),
      peak: point(peak),
      end: point(last),
      magnitude: round(Astronomy.Illumination(body, peak.time).mag),
      constellation: Astronomy.Constellation(j2000.ra, j2000.dec).name,
    };
  }
}

export default new PlanetsService();
