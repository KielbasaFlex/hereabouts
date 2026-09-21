import { cellCentroid, cellForPoint, haversine, type LatLon } from "@hereabouts/core";
import type { FeedRequest, FeedResponse, Mode, PlaceEvent } from "@hereabouts/contracts";

/**
 * Mode-dependent candidate radius, meters (PLAN.md §7.3 "look-ahead radius").
 * Ranking by ahead-ness and notability lands in Milestone 2; M1 just needs
 * *some* mode-appropriate radius so driving mode isn't limited to a
 * pedestrian's 400m.
 */
const MODE_RADIUS_M: Record<Mode, number> = {
  stationary: 400,
  walking: 400,
  biking: 1500,
  driving: 5000,
};

/**
 * Padding added to the upstream query radius to compensate for querying an
 * H3 cell centroid rather than the user's true position (PLAN.md §13): a
 * resolution-7 cell's centroid can be up to ~1.5km from a point inside it
 * (see `packages/core/src/cell`). Real distance is recomputed against the
 * true position below, so this padding only affects which candidates are
 * *fetched*, never which are shown or how far they're reported as being.
 */
const CELL_PADDING_M = 1500;

export interface FetchNearbyFn {
  (options: { center: LatLon; radiusM: number }): Promise<PlaceEvent[]>;
}

export interface FeedDependencies {
  fetchNearby: FetchNearbyFn;
}

/**
 * Builds a `/feed` response: rounds the true position to a privacy cell
 * before querying the (external, third-party) content source, then
 * recomputes real distance against the true position for filtering and
 * display, so accuracy is never traded away for privacy.
 */
export async function buildFeed(
  request: FeedRequest,
  deps: FeedDependencies,
): Promise<FeedResponse> {
  const truePosition: LatLon = { lat: request.lat, lon: request.lon };
  const modeRadiusM = MODE_RADIUS_M[request.mode];

  const cell = cellForPoint(truePosition);
  const centroid = cellCentroid(cell);
  const queryRadiusM = modeRadiusM + CELL_PADDING_M;

  const candidates = await deps.fetchNearby({ center: centroid, radiusM: queryRadiusM });

  const heardIds = new Set(request.heardIds);
  const places = candidates
    .map((place): PlaceEvent => ({ ...place, distanceM: haversine(truePosition, place) }))
    .filter((place) => (place.distanceM ?? Infinity) <= modeRadiusM)
    .filter((place) => !heardIds.has(place.id))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));

  return { places };
}
