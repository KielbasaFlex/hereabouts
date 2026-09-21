import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent, Route, RoutePack, RoutePackRequest } from "@hereabouts/contracts";
import { clusterPlaces, corridorTileSet, haversine, sampleCorridor, type LatLon } from "@hereabouts/core";
import { generateStoriesViaBatch, type BatchPlaceInput, type StoryCache } from "@hereabouts/storytelling";
import type { FeedDependencies } from "./feed.js";

/**
 * Route pack building (PLAN.md §11, Milestone 5): sample a route corridor,
 * ingest places along it from the same four content sources `/feed` uses,
 * dedupe, keep the most notable ones, batch-generate their stories, and
 * compute the tile list a PMTiles corridor slice would need — everything
 * `apps/web` needs to store offline and play back with the network gone.
 */

/** Caps pack size/cost — batch-generating every place ever found along a long corridor isn't the goal. */
const MAX_PLACES = 40;

/** Zoom range for the corridor's tile list — enough for both an overview and a walkable street level. */
const MIN_TILE_ZOOM = 12;
const MAX_TILE_ZOOM = 15;

const LICENSE_ATTRIBUTION: Record<PlaceEvent["license"], string> = {
  "cc-by-sa-4.0": "Wikipedia, CC BY-SA 4.0",
  cc0: "Wikidata, CC0",
  "odbl-1.0": "© OpenStreetMap contributors, ODbL",
  "public-domain-usgov": "US Government, public domain",
};

export interface RoutePackDependencies {
  /** Reused as-is from `/feed` — only the four content-source fetchers are called; no gap filler here. */
  feed: FeedDependencies;
  fetchRoute: (options: { origin: LatLon; destination: LatLon }) => Promise<Route>;
  /** Reads one of `tracks/*.gpx`'s sample tracks — no network needed, works even where OSRM is unreachable. */
  loadTrack: (trackId: string) => Promise<LatLon[]>;
  client: Pick<Anthropic, "messages">;
  cache: StoryCache;
}

async function resolveRoute(request: RoutePackRequest, deps: RoutePackDependencies): Promise<Route> {
  if (request.trackId) {
    const points = await deps.loadTrack(request.trackId);
    let distanceM = 0;
    for (let i = 1; i < points.length; i++) distanceM += haversine(points[i - 1]!, points[i]!);
    return { points, distanceM, durationS: 0 }; // no live-traffic duration estimate for a track-based "route"
  }
  // RoutePackRequest's own refinement guarantees origin+destination are both present here.
  return deps.fetchRoute({ origin: request.origin!, destination: request.destination! });
}

interface IngestedPlace {
  place: PlaceEvent;
  /** The nearest corridor sample (by route position) this place was found from, for route-ordering the pack. */
  distanceAlongRouteM: number;
}

/**
 * Ingests every corridor sample against the four content sources, tolerating
 * any single source/sample failing (same "degrade, don't fail the whole
 * pack" posture as `/feed`), then dedupes across sources *and* across
 * overlapping sample buffers.
 */
async function ingestCorridor(
  corridor: ReturnType<typeof sampleCorridor>,
  deps: FeedDependencies,
): Promise<IngestedPlace[]> {
  const distanceByPlaceId = new Map<string, number>();
  const candidates: PlaceEvent[] = [];

  function record(place: PlaceEvent, distanceAlongRouteM: number) {
    candidates.push(place);
    const existing = distanceByPlaceId.get(place.id);
    if (existing === undefined || distanceAlongRouteM < existing) distanceByPlaceId.set(place.id, distanceAlongRouteM);
  }

  for (const point of corridor) {
    const center: LatLon = { lat: point.lat, lon: point.lon };
    const radiusM = point.bufferRadiusM;

    const settled = await Promise.allSettled([
      deps.fetchWikipedia({ center, radiusM }),
      deps.fetchWikidata({ center, radiusM }),
      deps.fetchOverpass({ center, radiusM }),
    ]);
    settled.forEach((outcome, index) => {
      const source = ["wikipedia", "wikidata", "overpass"][index];
      if (outcome.status === "fulfilled") {
        for (const place of outcome.value) record(place, point.distanceAlongRouteM);
      } else {
        console.warn(`route-pack: source "${source}" failed at ${point.distanceAlongRouteM}m, continuing:`, outcome.reason);
      }
    });

    for (const place of deps.fetchNrhp({ center, radiusM })) record(place, point.distanceAlongRouteM);
  }

  return clusterPlaces(candidates).map((cluster) => {
    const memberIds = [cluster.preferred.id, ...cluster.supporting.map((s) => s.id)];
    const distanceAlongRouteM = Math.min(...memberIds.map((id) => distanceByPlaceId.get(id) ?? Infinity));
    return { place: cluster.preferred, distanceAlongRouteM };
  });
}

/**
 * Builds a full offline route pack: resolve the route, sample its corridor,
 * ingest and dedupe places along it, keep the `MAX_PLACES` most notable
 * (PLAN.md §11 step 3's "rank the corridor"), batch-generate their stories
 * in route order, and compute the tile list a PMTiles slice would need.
 */
export async function buildRoutePack(request: RoutePackRequest, deps: RoutePackDependencies): Promise<RoutePack> {
  const route = await resolveRoute(request, deps);
  const corridor = sampleCorridor(route.points, { mode: request.mode });

  const ingested = await ingestCorridor(corridor, deps.feed);

  const selected = ingested
    .sort((a, b) => b.place.notability - a.place.notability)
    .slice(0, MAX_PLACES)
    .sort((a, b) => a.distanceAlongRouteM - b.distanceAlongRouteM); // final pack order: along the route

  // No live heading exists for a pre-downloaded pack — narration must never
  // claim a specific side/direction it can't back up (PLAN.md §8.3), so
  // every place here gets "proximal" framing, never "directional".
  const batchInputs: BatchPlaceInput[] = selected.map(({ place }) => ({
    place,
    mode: request.mode,
    spatialFrame: { allow: "proximal", distanceM: place.distanceM ?? 0, side: null },
  }));

  const stories = await generateStoriesViaBatch({ inputs: batchInputs, client: deps.client, cache: deps.cache });

  const tiles = corridorTileSet(corridor, { minZoom: MIN_TILE_ZOOM, maxZoom: MAX_TILE_ZOOM });
  const attribution = [...new Set(selected.map(({ place }) => LICENSE_ATTRIBUTION[place.license]))];

  return {
    packId: `pack_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    mode: request.mode,
    route,
    places: selected.map((s) => s.place),
    stories,
    tiles,
    attribution,
    createdAt: new Date().toISOString(),
  };
}
