import { haversine, type LatLon } from "../geo/index.js";
import type { Mode } from "../mode/index.js";

/**
 * Corridor sampling (PLAN.md §11, Milestone 5): given a route polyline,
 * produce points every ~500m along it, each carrying the ingestion buffer
 * radius for the pack's travel mode — step 2 of the offline route-pack
 * pipeline, upstream of ingest/rank/batch-generate.
 *
 * `polyline` can come from a live routing adapter (`services/adapters/osrm`)
 * or, just as validly, from `packages/core/sim`'s GPX parser — a route pack
 * doesn't care where its polyline came from, which is what lets this run
 * end-to-end using the sample tracks in `tracks/` even when no live OSRM
 * endpoint is reachable (see `services/adapters/osrm/fixtures/README.md`).
 */

export interface CorridorPoint extends LatLon {
  /** Cumulative distance from the route's start, in meters. */
  distanceAlongRouteM: number;
  /** Ingestion radius for this pack's mode — how far off the route to look for places. */
  bufferRadiusM: number;
}

const DEFAULT_SPACING_M = 500;

/**
 * How far off the route line to search for places, per mode. Wider for
 * driving (places are still narratable at highway speed from farther away)
 * than walking, mirroring `spatial-frame`'s per-mode distance tiers.
 */
export const CORRIDOR_BUFFER_RADIUS_M: Record<Mode, number> = {
  stationary: 300,
  walking: 300,
  biking: 600,
  driving: 1200,
};

export interface SampleCorridorOptions {
  /** Target spacing between samples, in meters. Default 500 (PLAN.md §11). */
  spacingM?: number;
  mode: Mode;
}

/**
 * Samples `polyline` at `spacingM` intervals (default 500m), always
 * including the route's start and end points.
 *
 * Interpolates linearly in lat/lon between polyline vertices rather than
 * along the true great-circle path — an approximation, but one that's
 * negligible at this sampling density and consistent with `haversine`'s own
 * documented spherical-earth tolerance elsewhere in this module.
 */
export function sampleCorridor(polyline: readonly LatLon[], options: SampleCorridorOptions): CorridorPoint[] {
  if (polyline.length === 0) return [];

  const spacingM = options.spacingM ?? DEFAULT_SPACING_M;
  const bufferRadiusM = CORRIDOR_BUFFER_RADIUS_M[options.mode];
  const first = polyline[0]!;

  const samples: CorridorPoint[] = [{ lat: first.lat, lon: first.lon, distanceAlongRouteM: 0, bufferRadiusM }];

  let cumulativeDistanceM = 0;
  let nextSampleAtM = spacingM;

  for (let i = 1; i < polyline.length; i++) {
    const prev = polyline[i - 1]!;
    const curr = polyline[i]!;
    const legLengthM = haversine(prev, curr);
    if (legLengthM === 0) continue;

    while (nextSampleAtM <= cumulativeDistanceM + legLengthM) {
      const t = (nextSampleAtM - cumulativeDistanceM) / legLengthM;
      samples.push({
        lat: prev.lat + (curr.lat - prev.lat) * t,
        lon: prev.lon + (curr.lon - prev.lon) * t,
        distanceAlongRouteM: nextSampleAtM,
        bufferRadiusM,
      });
      nextSampleAtM += spacingM;
    }
    cumulativeDistanceM += legLengthM;
  }

  const last = polyline[polyline.length - 1]!;
  const lastSample = samples[samples.length - 1]!;
  // Always include the true endpoint, even if it falls short of the next
  // regular spacing interval — a route pack must cover the whole route.
  if (cumulativeDistanceM - lastSample.distanceAlongRouteM > 1) {
    samples.push({ lat: last.lat, lon: last.lon, distanceAlongRouteM: cumulativeDistanceM, bufferRadiusM });
  }

  return samples;
}
