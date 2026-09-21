import type { LatLon } from "@hereabouts/core/geo";

/**
 * OSRM routing adapter (PLAN.md §11, SOURCES.md "Routing — OSRM /
 * OpenRouteService"): turns an origin/destination pair into the driving
 * route polyline a Milestone 5 route pack corridor-samples.
 *
 * **The public demo server (`router.project-osrm.org`) is dev-only** —
 * SOURCES.md already documents its ~1 req/s non-commercial cap and explicit
 * ban on exactly this app's shape (repeated calls from one app). Production
 * must point `endpoint` at a self-hosted OSRM instance; this module has no
 * opinion on which, same as `services/adapters/overpass`'s public-instance
 * caveat.
 */

export const OSRM_DEMO_ENDPOINT = "https://router.project-osrm.org";

export type { LatLon };

export interface Route {
  points: LatLon[];
  distanceM: number;
  durationS: number;
}

export interface FetchRouteOptions {
  origin: LatLon;
  destination: LatLon;
  endpoint?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: Array<{
    geometry: { type: "LineString"; coordinates: [number, number][] };
    distance: number;
    duration: number;
  }>;
}

/**
 * Fetches a driving route between `origin` and `destination` and returns
 * its polyline (already decoded — `geometries=geojson` avoids needing a
 * separate polyline-decoding step) plus total distance/duration.
 *
 * Throws with OSRM's own `code`/`message` on a non-"Ok" response (e.g. `
 * NoRoute` when the two points aren't connected) — never a `Route` with an
 * empty polyline pretending to be a valid pack.
 */
export async function fetchRoute(options: FetchRouteOptions): Promise<Route> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? OSRM_DEMO_ENDPOINT;
  const coords = `${options.origin.lon},${options.origin.lat};${options.destination.lon},${options.destination.lat}`;
  const url = `${endpoint}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OsrmRouteResponse;
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) {
    throw new Error(`OSRM returned no route (code: ${data.code}${data.message ? `, message: ${data.message}` : ""})`);
  }

  return {
    points: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceM: route.distance,
    durationS: route.duration,
  };
}
