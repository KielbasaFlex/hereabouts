import { cellToLatLng, latLngToCell } from "h3-js";
import type { LatLon } from "../geo/index.js";

/**
 * H3 resolution used for both fetch bookkeeping (PLAN.md §4.3
 * `coverage_cell`) and the privacy boundary (PLAN.md §13): third-party
 * source queries are issued for a cell centroid, never the user's true
 * coordinates. Resolution 7 has an edge length of ~1.22 km — small enough
 * to keep candidate results locally relevant, large enough that an upstream
 * source can't distinguish one user from a cache warm.
 */
export const COVERAGE_H3_RESOLUTION = 7;

export type H3Index = string;

/** Maps a point to its H3 cell id at the given resolution (default: {@link COVERAGE_H3_RESOLUTION}). */
export function cellForPoint(point: LatLon, resolution: number = COVERAGE_H3_RESOLUTION): H3Index {
  return latLngToCell(point.lat, point.lon, resolution);
}

/** Returns the geographic centroid of an H3 cell. */
export function cellCentroid(cell: H3Index): LatLon {
  const [lat, lon] = cellToLatLng(cell);
  return { lat, lon };
}
