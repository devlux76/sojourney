export const CRATER_LAKE = { lat: 42.94, lon: -122.11 };

export interface Equatorial { ra: number; dec: number; }
export interface Horizontal { alt: number; az: number; }
export interface Vec3 { x: number; y: number; z: number; }

const RAD = Math.PI / 180;
const MOON_HORIZONTAL_PARALLAX = 0.95;

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

function obliquity(d: number) {
  return 23.439 - 0.00000036 * d;
}

function eclipticToEquatorial(lon: number, lat: number, eps: number): Equatorial {
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * RAD) * sin(eps), cos(lon)) / RAD;
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) / RAD;
  return { ra: norm360(ra), dec };
}

export function sunEquatorial(date: Date): Equatorial & { lon: number } {
  const d = daysSinceJ2000(date);
  const g = 357.529 + 0.98560028 * d;
  const lon = norm360(280.459 + 0.98564736 * d + 1.915 * sin(g) + 0.020 * sin(2 * g));
  return { ...eclipticToEquatorial(lon, 0, obliquity(d)), lon };
}

export function moonEquatorial(date: Date): Equatorial & { lon: number; lat: number } {
  const d = daysSinceJ2000(date);
  const L = 218.316 + 13.176396 * d;
  const Mm = 134.963 + 13.064993 * d;
  const Ms = 357.529 + 0.98560028 * d;
  const D = 297.850 + 12.190749 * d;
  const F = 93.272 + 13.229350 * d;
  const lon = norm360(L + 6.289 * sin(Mm) + 1.274 * sin(2 * D - Mm) + 0.658 * sin(2 * D)
    + 0.214 * sin(2 * Mm) - 0.186 * sin(Ms) - 0.114 * sin(2 * F));
  const lat = 5.128 * sin(F) + 0.281 * sin(Mm + F) + 0.278 * sin(Mm - F) + 0.173 * sin(2 * D - F);
  return { ...eclipticToEquatorial(lon, lat, obliquity(d)), lon, lat };
}

export function localSiderealTime(date: Date, lon: number): number {
  return norm360(280.46061837 + 360.98564736629 * daysSinceJ2000(date) + lon);
}

export function equatorialToHorizontal(eq: Equatorial, date: Date, lat = CRATER_LAKE.lat, lon = CRATER_LAKE.lon): Horizontal {
  const h = localSiderealTime(date, lon) - eq.ra;
  const alt = Math.asin(sin(lat) * sin(eq.dec) + cos(lat) * cos(eq.dec) * cos(h)) / RAD;
  const az = Math.atan2(-cos(eq.dec) * sin(h), sin(eq.dec) * cos(lat) - cos(eq.dec) * sin(lat) * cos(h)) / RAD;
  return { alt, az: norm360(az) };
}

export function sunPosition(date: Date, lat = CRATER_LAKE.lat, lon = CRATER_LAKE.lon): Horizontal {
  return sunPositionToRef(date, lat, lon, { alt: 0, az: 0 });
}

// Write into caller-owned state for the per-frame celestial update; the convenience wrapper keeps
// the original allocating API for infrequent callers.
export function sunPositionToRef(date: Date, lat: number, lon: number, result: Horizontal): Horizontal {
  const equatorial = sunEquatorial(date);
  const h = localSiderealTime(date, lon) - equatorial.ra;
  const sinLat = sin(lat), cosLat = cos(lat);
  const sinDec = sin(equatorial.dec), cosDec = cos(equatorial.dec);
  result.alt = Math.asin(sinLat * sinDec + cosLat * cosDec * cos(h)) / RAD;
  result.az = norm360(Math.atan2(-cosDec * sin(h), sinDec * cosLat - cosDec * sinLat * cos(h)) / RAD);
  return result;
}

export function moonPosition(date: Date, lat = CRATER_LAKE.lat, lon = CRATER_LAKE.lon): Horizontal {
  const h = equatorialToHorizontal(moonEquatorial(date), date, lat, lon);
  return { alt: h.alt - MOON_HORIZONTAL_PARALLAX * cos(h.alt), az: h.az };
}

export function moonIllumination(date: Date): { fraction: number; waxing: boolean } {
  const s = sunEquatorial(date), m = moonEquatorial(date);
  const cosElongation = sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra);
  return { fraction: (1 - cosElongation) / 2, waxing: norm360(m.lon - s.lon) < 180 };
}

export function horizontalToVector(h: Horizontal): Vec3 {
  return horizontalToVectorToRef(h, { x: 0, y: 0, z: 0 });
}

export function horizontalToVectorToRef(h: Horizontal, result: Vec3): Vec3 {
  const cosAlt = cos(h.alt);
  result.x = cosAlt * sin(h.az);
  result.y = sin(h.alt);
  result.z = cosAlt * cos(h.az);
  return result;
}

export function equatorialToVector(eq: Equatorial): Vec3 {
  return { x: cos(eq.dec) * cos(eq.ra), y: cos(eq.dec) * sin(eq.ra), z: sin(eq.dec) };
}

export function celestialBasis(date: Date, lat = CRATER_LAKE.lat, lon = CRATER_LAKE.lon): Float32Array {
  return celestialBasisToRef(date, lat, lon, new Float32Array(9));
}

// Fill the fixed equatorial basis directly into its output buffer; it is sampled every frame, so
// constructing three coordinate objects, an intermediate array, and a typed array is unnecessary.
export function celestialBasisToRef(date: Date, lat: number, lon: number, output: Float32Array): Float32Array {
  const sidereal = localSiderealTime(date, lon);
  const sinLat = sin(lat), cosLat = cos(lat);
  const put = (index: number, ra: number, dec: number) => {
    const h = sidereal - ra;
    const sinDec = sin(dec), cosDec = cos(dec);
    const altitude = Math.asin(sinLat * sinDec + cosLat * cosDec * cos(h)) / RAD;
    const azimuth = Math.atan2(-cosDec * sin(h), sinDec * cosLat - cosDec * sinLat * cos(h));
    const cosAltitude = cos(altitude);
    output[index] = cosAltitude * Math.sin(azimuth);
    output[index + 1] = sin(altitude);
    output[index + 2] = cosAltitude * Math.cos(azimuth);
  };
  put(0, 0, 0);
  put(3, 90, 0);
  put(6, 0, 90);
  return output;
}
