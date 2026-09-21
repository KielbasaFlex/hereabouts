import type { PlaceEvent } from "@hereabouts/contracts";

/**
 * Wikipedia GeoSearch + extracts adapter (PLAN.md §6, SOURCES.md §1).
 *
 * Two calls: `list=geosearch` finds nearby articles, then `prop=extracts`
 * fetches their lead-section text in one batched request. Both go through
 * `formatversion=2` for a cleaner (array-based) response shape.
 *
 * M1 reads the returned extract aloud verbatim (`summary` and
 * `sourceExcerpt` are the same raw text) — the LLM storytelling pipeline
 * that turns this into scaled, grounded, non-mirroring narration lands in
 * Milestone 3 (PLAN.md §8).
 */

export const HEREABOUTS_USER_AGENT =
  "Hereabouts/0.1 (https://hereabouts.app; contact@hereabouts.app)";

const API_BASE = "https://en.wikipedia.org/w/api.php";

/** Wikipedia's own documented limits (SOURCES.md §1) — inputs are clamped to these, never rejected. */
export const GEOSEARCH_MIN_RADIUS_M = 10;
export const GEOSEARCH_MAX_RADIUS_M = 10_000;
export const GEOSEARCH_MAX_LIMIT = 500;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface FetchNearbyOptions {
  center: LatLon;
  /** Search radius in meters; clamped to Wikipedia's [10, 10000] range. */
  radiusM: number;
  /** Max number of candidates; clamped to Wikipedia's max of 500. Default 20. */
  limit?: number;
  /** Approximate character length of the returned extract (the API's own `exchars`). Default 600. */
  extractChars?: number;
  /** Overrides {@link HEREABOUTS_USER_AGENT} — callers should pass their own configured UA. */
  userAgent?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface GeoSearchResult {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

interface GeoSearchResponse {
  query?: { geosearch?: GeoSearchResult[] };
}

interface ExtractPage {
  pageid: number;
  title: string;
  extract?: string;
  fullurl?: string;
  missing?: boolean;
}

interface ExtractsResponse {
  query?: { pages?: ExtractPage[] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function callApi<T>(
  fetchImpl: typeof fetch,
  userAgent: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(API_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetchImpl(url.toString(), {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia API request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Fetches Wikipedia articles near `center` and normalises them into
 * {@link PlaceEvent} records.
 *
 * `distanceM` on the returned records is the distance from `center` as
 * GeoSearch reports it. If `center` is a privacy-rounded cell centroid
 * rather than the caller's true position (PLAN.md §13), the caller is
 * responsible for recomputing real distance against the true position
 * before using it for ranking or display — this adapter has no opinion on
 * where `center` came from.
 */
export async function fetchNearbyPlaces(options: FetchNearbyOptions): Promise<PlaceEvent[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? HEREABOUTS_USER_AGENT;
  const radiusM = clamp(
    Math.round(options.radiusM),
    GEOSEARCH_MIN_RADIUS_M,
    GEOSEARCH_MAX_RADIUS_M,
  );
  const limit = clamp(options.limit ?? 20, 1, GEOSEARCH_MAX_LIMIT);
  const extractChars = options.extractChars ?? 600;

  const geo = await callApi<GeoSearchResponse>(fetchImpl, userAgent, {
    action: "query",
    list: "geosearch",
    gscoord: `${options.center.lat}|${options.center.lon}`,
    gsradius: String(radiusM),
    gslimit: String(limit),
    format: "json",
    formatversion: "2",
  });

  const results = geo.query?.geosearch ?? [];
  if (results.length === 0) return [];

  const extracts = await callApi<ExtractsResponse>(fetchImpl, userAgent, {
    action: "query",
    prop: "extracts|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exchars: String(extractChars),
    pageids: results.map((r) => r.pageid).join("|"),
    format: "json",
    formatversion: "2",
  });

  const pagesById = new Map<number, ExtractPage>();
  for (const page of extracts.query?.pages ?? []) {
    pagesById.set(page.pageid, page);
  }

  const places: PlaceEvent[] = [];
  for (const result of results) {
    const page = pagesById.get(result.pageid);
    const extract = page?.extract?.trim();
    if (!page || page.missing || !extract) continue; // nothing to ground narration on

    const sourceUrl =
      page.fullurl ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, "_"))}`;

    places.push({
      id: `wikipedia:${result.pageid}`,
      source: "wikipedia",
      sourceId: String(result.pageid),
      title: result.title,
      lat: result.lat,
      lon: result.lon,
      distanceM: result.dist,
      datePrecision: "unknown",
      summary: extract,
      sourceExcerpt: extract,
      sourceUrl,
      license: "cc-by-sa-4.0",
      topics: [],
    });
  }

  return places;
}
