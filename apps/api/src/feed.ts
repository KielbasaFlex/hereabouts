import {
  cellCentroid,
  cellForPoint,
  clusterPlaces,
  haversine,
  rankPlaces,
  type LatLon,
  type Mode,
} from "@hereabouts/core";
import type { FeedRequest, FeedResponse, PlaceEvent } from "@hereabouts/contracts";

/**
 * Mode-dependent candidate radius, meters (PLAN.md §7.3 "look-ahead radius").
 * Full ahead-ness-based cone widening (§7.3's per-mode cone angle) is
 * `packages/core/rank`'s `aheadness` scoring term, not a query-radius
 * change — the radius here just bounds *what's fetched*.
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

/** Gap-filler settlement search radius (PLAN.md §7.6) — wide, since named settlements are sparse. */
const GAP_FILLER_SETTLEMENT_RADIUS_M = 50_000;

export interface FetchSourceFn {
  (options: { center: LatLon; radiusM: number }): Promise<PlaceEvent[]>;
}

export interface FetchLocalDatasetFn {
  (options: { center: LatLon; radiusM: number }): PlaceEvent[];
}

export interface NearestSettlementResult {
  label: string;
  wikipediaTitle: string;
  lat: number;
  lon: number;
}

export interface FeedDependencies {
  fetchWikipedia: FetchSourceFn;
  fetchWikidata: FetchSourceFn;
  fetchOverpass: FetchSourceFn;
  /** Synchronous: NRHP is a local-dataset lookup, not a network call (PLAN.md §6/§16.3's note on why). */
  fetchNrhp: FetchLocalDatasetFn;
  /** For the gap filler (PLAN.md §7.6): nearest named settlement to a point. */
  fetchNearestSettlement: (options: { center: LatLon; radiusM: number }) => Promise<NearestSettlementResult | null>;
  /** For the gap filler: the settlement's own Wikipedia article. */
  fetchWikipediaArticle: (options: { title: string; lat: number; lon: number }) => Promise<PlaceEvent | null>;
}

interface NamedSourceResult {
  source: string;
  places: PlaceEvent[];
}

/**
 * Calls the three live-network sources concurrently and tolerates any of
 * them failing (PLAN.md §16.3: WDQS reliability and the Overpass public
 * instance are both explicitly "degrade silently, don't fail the request"
 * sources) — a wobble in one source should never take down a feed that two
 * other sources could still answer. NRHP has no failure mode to catch: it's
 * a synchronous local-dataset lookup, not a network call.
 */
async function fetchAllSources(
  centroid: LatLon,
  radiusM: number,
  deps: FeedDependencies,
): Promise<NamedSourceResult[]> {
  const jobs: Array<{ source: string; promise: Promise<PlaceEvent[]> }> = [
    { source: "wikipedia", promise: deps.fetchWikipedia({ center: centroid, radiusM }) },
    { source: "wikidata", promise: deps.fetchWikidata({ center: centroid, radiusM }) },
    { source: "overpass", promise: deps.fetchOverpass({ center: centroid, radiusM }) },
  ];

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  const results: NamedSourceResult[] = [];
  settled.forEach((outcome, index) => {
    const source = jobs[index]!.source;
    if (outcome.status === "fulfilled") {
      results.push({ source, places: outcome.value });
    } else {
      // Structured logging of "which source returned what and why" is
      // PLAN.md §14's requirement; a console line is the placeholder for
      // that until a real logger (pino) is wired up.
      console.warn(`feed: source "${source}" failed, continuing without it:`, outcome.reason);
    }
  });

  results.push({ source: "nrhp", places: deps.fetchNrhp({ center: centroid, radiusM }) });
  return results;
}

/**
 * The gap filler (PLAN.md §7.6): when nothing point-level survives ranking,
 * find the nearest named settlement and serve its own Wikipedia article,
 * honestly framed as regional rather than site-specific. Only the framed
 * `summary` (what's spoken/displayed as narration) carries the framing
 * prefix — `sourceExcerpt`, the grounding substrate, stays exactly as
 * fetched, unedited, so it remains usable as clean source material once
 * Milestone 3 generates narration from it.
 *
 * This is deliberately a single practical tier, not PLAN.md §7.6's full
 * neighbourhood → city → county → state cascade — see
 * `@hereabouts/adapter-wikidata`'s fixtures/README.md for why (WDQS has no
 * cheap point-in-polygon query, so this approximates containment via
 * nearest-settlement search).
 */
async function buildGapFiller(
  truePosition: LatLon,
  heardIds: ReadonlySet<string>,
  deps: FeedDependencies,
): Promise<PlaceEvent | null> {
  let settlement: NearestSettlementResult | null;
  try {
    settlement = await deps.fetchNearestSettlement({
      center: truePosition,
      radiusM: GAP_FILLER_SETTLEMENT_RADIUS_M,
    });
  } catch (error) {
    console.warn("feed: gap-filler settlement lookup failed:", error);
    return null;
  }
  if (!settlement) return null;

  let article: PlaceEvent | null;
  try {
    article = await deps.fetchWikipediaArticle({
      title: settlement.wikipediaTitle,
      lat: settlement.lat,
      lon: settlement.lon,
    });
  } catch (error) {
    console.warn("feed: gap-filler article lookup failed:", error);
    return null;
  }
  if (!article || heardIds.has(article.id)) return null;

  return {
    ...article,
    distanceM: haversine(truePosition, settlement),
    summary: `Around this part of ${settlement.label}: ${article.summary}`,
  };
}

/**
 * Builds a `/feed` response. Rounds the true position to an H3 cell
 * centroid before querying any third-party source, then recomputes real
 * distance against the true position for filtering/sorting — privacy
 * rounding never costs accuracy. Candidates from all four sources are
 * clustered (deduplicating the same real-world place across sources) and
 * ranked; if nothing survives the mode radius and novelty filter, the gap
 * filler keeps the narration going instead of falling silent.
 */
export async function buildFeed(request: FeedRequest, deps: FeedDependencies): Promise<FeedResponse> {
  const truePosition: LatLon = { lat: request.lat, lon: request.lon };
  const modeRadiusM = MODE_RADIUS_M[request.mode];

  const cell = cellForPoint(truePosition);
  const centroid = cellCentroid(cell);
  const queryRadiusM = modeRadiusM + CELL_PADDING_M;

  const sourceResults = await fetchAllSources(centroid, queryRadiusM, deps);
  const candidates = sourceResults.flatMap((result) => result.places);

  const clusters = clusterPlaces(candidates);
  const heardIds = new Set(request.heardIds);

  const inRange = clusters
    .map((cluster): PlaceEvent => ({ ...cluster.preferred, distanceM: haversine(truePosition, cluster.preferred) }))
    .filter((place) => (place.distanceM ?? Infinity) <= modeRadiusM)
    .filter((place) => !heardIds.has(place.id));

  if (inRange.length > 0) {
    const ranked = rankPlaces(
      inRange,
      { lat: request.lat, lon: request.lon, headingDeg: request.headingDeg, speedMps: request.speedMps },
      { mode: request.mode, heardIds, preferredTopics: request.topics },
    );
    return { places: ranked.map((r) => r.place) };
  }

  const gapFillerPlace = await buildGapFiller(truePosition, heardIds, deps);
  return { places: gapFillerPlace ? [gapFillerPlace] : [] };
}
