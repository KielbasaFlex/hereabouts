/**
 * Pure geospatial math. No I/O, no platform dependencies.
 *
 * Bearings and headings throughout this module use compass convention:
 * degrees clockwise from true north, 0-360, with 0 = north, 90 = east.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalizes an angle in degrees to the range [0, 360). */
export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Great-circle distance between two points, in meters.
 * Haversine formula; assumes a spherical earth, which is precise enough
 * (~0.3% error) for the ranking and admission decisions this powers.
 */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial compass bearing (degrees, 0-360) travelling from `a` to `b`
 * along the great-circle path.
 */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Signed angular difference (degrees, -180..180) from `from` to `to`. */
export function angleDiffDeg(from: number, to: number): number {
  const diff = normalizeDeg(to - from);
  return diff > 180 ? diff - 360 : diff;
}

/**
 * "Ahead-ness" of a target relative to the observer's current heading:
 * 1 = directly ahead, 0 = directly to either side, -1 = directly behind.
 *
 * This is deliberately not a boolean. Ranking (packages/core/rank, M2)
 * blends this continuous value with distance and notability rather than
 * hard-cutting on a cone.
 */
export function aheadness(observer: LatLon, headingDeg: number, target: LatLon): number {
  const bearingToTarget = bearing(observer, target);
  return Math.cos(toRad(angleDiffDeg(headingDeg, bearingToTarget)));
}

export interface ClosestApproach {
  /** Great-circle distance from observer to target, in meters. */
  distanceM: number;
  /** Compass bearing from observer to target, in degrees. */
  bearingDeg: number;
  /** Ahead-ness of the target given the observer's heading; see {@link aheadness}. */
  aheadness: number;
}

/**
 * Bundles the three geometric facts the scheduler needs about a candidate
 * place: how far it is, what direction it's in, and how much it's "ahead"
 * of the observer's current travel direction.
 */
export function closestApproach(
  observer: LatLon,
  headingDeg: number,
  target: LatLon,
): ClosestApproach {
  const distanceM = haversine(observer, target);
  const bearingDeg = bearing(observer, target);
  return {
    distanceM,
    bearingDeg,
    aheadness: Math.cos(toRad(angleDiffDeg(headingDeg, bearingDeg))),
  };
}

/**
 * Estimated seconds until arrival at `distanceM`, given `speedMps`.
 * Returns `Infinity` for a stationary or negligible speed rather than
 * dividing by zero, so callers can treat "never arriving" uniformly.
 */
export function etaSeconds(distanceM: number, speedMps: number): number {
  if (speedMps <= 0.05) return Infinity;
  return distanceM / speedMps;
}
