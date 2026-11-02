import * as Astronomy from 'astronomy-engine';

// Named stars of visual magnitude 2.5 or brighter: the ones that show through typical
// suburban light pollution. [name, RA (J2000, h m s), Dec (J2000, ° ′ ″), magnitude]
const CATALOG = [
  ['Sirius', '06 45 08.9', '-16 42 58', -1.46],
  ['Canopus', '06 23 57.1', '-52 41 44', -0.74],
  ['Rigil Kentaurus', '14 39 36.5', '-60 50 02', -0.27],
  ['Arcturus', '14 15 39.7', '+19 10 57', -0.05],
  ['Vega', '18 36 56.3', '+38 47 01', 0.03],
  ['Capella', '05 16 41.4', '+45 59 53', 0.08],
  ['Rigel', '05 14 32.3', '-08 12 06', 0.13],
  ['Procyon', '07 39 18.1', '+05 13 30', 0.34],
  ['Achernar', '01 37 42.8', '-57 14 12', 0.46],
  ['Betelgeuse', '05 55 10.3', '+07 24 25', 0.50],
  ['Hadar', '14 03 49.4', '-60 22 23', 0.61],
  ['Altair', '19 50 47.0', '+08 52 06', 0.76],
  ['Acrux', '12 26 35.9', '-63 05 57', 0.76],
  ['Aldebaran', '04 35 55.2', '+16 30 33', 0.86],
  ['Antares', '16 29 24.5', '-26 25 55', 0.96],
  ['Spica', '13 25 11.6', '-11 09 41', 0.97],
  ['Pollux', '07 45 18.9', '+28 01 34', 1.14],
  ['Fomalhaut', '22 57 39.0', '-29 37 20', 1.16],
  ['Deneb', '20 41 25.9', '+45 16 49', 1.25],
  ['Mimosa', '12 47 43.3', '-59 41 19', 1.25],
  ['Regulus', '10 08 22.3', '+11 58 02', 1.35],
  ['Adhara', '06 58 37.5', '-28 58 20', 1.50],
  ['Castor', '07 34 35.9', '+31 53 18', 1.58],
  ['Shaula', '17 33 36.5', '-37 06 14', 1.62],
  ['Gacrux', '12 31 09.9', '-57 06 48', 1.64],
  ['Bellatrix', '05 25 07.9', '+06 20 59', 1.64],
  ['Elnath', '05 26 17.5', '+28 36 27', 1.65],
  ['Miaplacidus', '09 13 12.0', '-69 43 02', 1.67],
  ['Alnilam', '05 36 12.8', '-01 12 07', 1.69],
  ['Regor', '08 09 32.0', '-47 20 12', 1.72],
  ['Alnair', '22 08 14.0', '-46 57 40', 1.73],
  ['Alnitak', '05 40 45.5', '-01 56 34', 1.77],
  ['Alioth', '12 54 01.7', '+55 57 35', 1.77],
  ['Dubhe', '11 03 43.7', '+61 45 03', 1.79],
  ['Mirfak', '03 24 19.4', '+49 51 40', 1.79],
  ['Wezen', '07 08 23.5', '-26 23 36', 1.84],
  ['Kaus Australis', '18 24 10.3', '-34 23 05', 1.85],
  ['Avior', '08 22 30.8', '-59 30 34', 1.86],
  ['Alkaid', '13 47 32.4', '+49 18 48', 1.86],
  ['Sargas', '17 37 19.1', '-42 59 52', 1.86],
  ['Menkalinan', '05 59 31.7', '+44 56 51', 1.90],
  ['Atria', '16 48 39.9', '-69 01 40', 1.91],
  ['Alhena', '06 37 42.7', '+16 23 57', 1.92],
  ['Peacock', '20 25 38.9', '-56 44 06', 1.94],
  ['Alsephina', '08 44 42.2', '-54 42 30', 1.96],
  ['Mirzam', '06 22 42.0', '-17 57 21', 1.98],
  ['Alphard', '09 27 35.2', '-08 39 31', 1.98],
  ['Polaris', '02 31 49.1', '+89 15 51', 1.98],
  ['Hamal', '02 07 10.4', '+23 27 45', 2.00],
  // Magnitude 2.0 to 2.5: still visible from the suburbs, and they fill in the familiar
  // shapes (the Big Dipper, Cassiopeia, the Great Square of Pegasus)
  ['Algieba', '10 19 58.4', '+19 50 29', 2.01],
  ['Mizar', '13 23 55.5', '+54 55 31', 2.04],
  ['Diphda', '00 43 35.4', '-17 59 12', 2.04],
  ['Nunki', '18 55 15.9', '-26 17 48', 2.05],
  ['Mirach', '01 09 43.9', '+35 37 14', 2.05],
  ['Alpheratz', '00 08 23.3', '+29 05 26', 2.06],
  ['Rasalhague', '17 34 56.1', '+12 33 36', 2.07],
  ['Tiaki', '22 42 40.1', '-46 53 05', 2.07],
  ['Kochab', '14 50 42.3', '+74 09 20', 2.08],
  ['Saiph', '05 47 45.4', '-09 40 11', 2.09],
  ['Algol', '03 08 10.1', '+40 57 20', 2.12],
  ['Denebola', '11 49 03.6', '+14 34 19', 2.13],
  ['Muhlifain', '12 41 31.0', '-48 57 36', 2.17],
  ['Aspidiske', '09 17 05.4', '-59 16 31', 2.21],
  ['Suhail', '09 07 59.8', '-43 25 57', 2.21],
  ['Alphecca', '15 34 41.3', '+26 42 53', 2.22],
  ['Sadr', '20 22 13.7', '+40 15 24', 2.23],
  ['Eltanin', '17 56 36.4', '+51 29 20', 2.23],
  ['Mintaka', '05 32 00.4', '-00 17 57', 2.23],
  ['Schedar', '00 40 30.4', '+56 32 14', 2.24],
  ['Caph', '00 09 10.7', '+59 08 59', 2.28],
  ['Dschubba', '16 00 20.0', '-22 37 18', 2.29],
  ['Larawag', '16 50 09.8', '-34 17 36', 2.29],
  ['Izar', '14 44 59.2', '+27 04 27', 2.35],
  ['Merak', '11 01 50.5', '+56 22 57', 2.37],
  ['Enif', '21 44 11.2', '+09 52 30', 2.38],
  ['Ankaa', '00 26 17.1', '-42 18 22', 2.38],
  ['Scheat', '23 03 46.5', '+28 04 58', 2.42],
  ['Sabik', '17 10 22.7', '-15 43 29', 2.43],
  ['Phecda', '11 53 49.8', '+53 41 41', 2.44],
  ['Aludra', '07 24 05.7', '-29 18 11', 2.45],
  ['Alderamin', '21 18 34.8', '+62 35 08', 2.45],
  ['Markeb', '09 22 06.8', '-55 00 38', 2.47],
  ['Markab', '23 04 45.7', '+15 12 19', 2.48],
];

// "06 45 08.9" -> 6.7525; "-16 42 58" -> -16.716
const sexagesimal = (text) => {
  const [whole, minutes, seconds] = text.split(' ').map(Number);
  const sign = text.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(whole) + minutes / 60 + seconds / 3600);
};

// Brightest first, so a capped list keeps the brightest
const STARS = [...CATALOG].sort((a, b) => a[3] - b[3]).map(([name, ra, dec, magnitude]) => {
  const raHours = sexagesimal(ra);
  const decDegrees = sexagesimal(dec);
  return {
    id: name.toLowerCase().replace(/ /g, '-'),
    name,
    ra: raHours,
    dec: decDegrees,
    magnitude,
    // Constellation boundaries are defined in J2000 coordinates
    constellation: Astronomy.Constellation(raHours, decDegrees).name,
  };
});

// Higher than for planets and the ISS: near the horizon, haze and extra air dim a star by
// up to a magnitude, which hides the fainter ones in this list from a suburban sky
const MIN_ALTITUDE_DEG = 15;
const STEP_MS = 60000;
// Enough to fill the sky without listing every faint one; the brightest up tonight are kept
const MAX_STARS = 20;

const round = (value) => Math.round(value * 10) / 10;

class StarsService {
  /**
   * The MAX_STARS brightest catalog stars that are at least MIN_ALTITUDE_DEG above the horizon
   * at some point between `start` and `end` (Dates) for an observer at lat/lon. Brightest first.
   * Returns [{ id, name, start, peak, end, magnitude, constellation }], where start/peak/end are
   * { time: Date, altitude, azimuth } in degrees, clipped to [start, end].
   */
  getVisibleStars({ lat, lon, start, end }) {
    const observer = new Astronomy.Observer(lat, lon, 0);
    // Precess J2000 positions to the date once: they move well under 1″ over one evening
    const rotation = Astronomy.Rotation_EQJ_EQD(new Date((start.getTime() + end.getTime()) / 2));
    return STARS
      .map(star => this.#visibility(star, observer, rotation, start, end))
      .filter(Boolean)
      .slice(0, MAX_STARS);
  }

  #visibility(star, observer, rotation, start, end) {
    const j2000 = Astronomy.VectorFromSphere(new Astronomy.Spherical(star.dec, star.ra * 15, 1), start);
    const { ra, dec } = Astronomy.EquatorFromVector(Astronomy.RotateVector(rotation, j2000));

    let first = null;
    let last = null;
    let peak = null;
    for (let t = start.getTime(); t <= end.getTime(); t += STEP_MS) {
      const time = new Date(t);
      const { altitude, azimuth } = Astronomy.Horizon(time, observer, ra, dec, 'normal');
      if (altitude < MIN_ALTITUDE_DEG) continue;

      const sample = { time, altitude, azimuth };
      if (!first) first = sample;
      if (!peak || altitude > peak.altitude) peak = sample;
      last = sample;
    }
    if (!peak) return null;

    const point = (s) => ({ time: s.time, altitude: round(s.altitude), azimuth: round(s.azimuth) });
    return {
      id: star.id,
      name: star.name,
      start: point(first),
      peak: point(peak),
      end: point(last),
      magnitude: star.magnitude,
      constellation: star.constellation,
    };
  }
}

export default new StarsService();
