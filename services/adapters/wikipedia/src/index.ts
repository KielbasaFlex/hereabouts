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
  /** Present when `prop` includes `pageprops` and the article has an associated Wikidata item. */
  pageprops?: { wikibase_item?: string };
}

interface ExtractsResponse {
  query?: { pages?: ExtractPage[] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Cheap notability proxy (PLAN.md §7.4): "incoming links + article length +
 * pageviews" is the target heuristic, but pageviews/backlinks need a
 * separate API call this adapter doesn't make. Extract length is the part
 * we already have for free — a longer lead section correlates loosely with
 * a more substantial article. Deliberately capped well below 1.0 so a
 * length-only heuristic never outranks a source with real signal.
 */
function estimateNotability(extractLength: number): number {
  return Math.min(0.6, 0.2 + extractLength / 2000);
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
    prop: "extracts|info|pageprops",
    inprop: "url",
    ppprop: "wikibase_item",
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
      notability: estimateNotability(extract.length),
      externalIds: {
        wikipediaTitle: result.title,
        ...(page.pageprops?.wikibase_item ? { wikidataQid: page.pageprops.wikibase_item } : {}),
      },
    });
  }

  return places;
}

export interface FetchArticleByTitleOptions {
  title: string;
  /**
   * Coordinates to attach to the result. This function doesn't do its own
   * coordinate lookup — callers using it for the gap filler (PLAN.md §7.6)
   * already have the relevant point (e.g. the settlement's own coordinates
   * from the Wikidata adapter) and reusing it avoids a second round-trip.
   */
  lat: number;
  lon: number;
  extractChars?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches a single Wikipedia article by exact title — used by the gap
 * filler to pull the regional (settlement-level) article once
 * `@hereabouts/adapter-wikidata`'s `fetchNearestSettlement` has named it.
 * Returns `null` if the title doesn't resolve to an article with a lead
 * extract (missing page, disambiguation stub, redirect loop, etc.).
 */
export async function fetchArticleByTitle(options: FetchArticleByTitleOptions): Promise<PlaceEvent | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? HEREABOUTS_USER_AGENT;
  const extractChars = options.extractChars ?? 600;

  const response = await callApi<ExtractsResponse>(fetchImpl, userAgent, {
    action: "query",
    prop: "extracts|info|pageprops",
    inprop: "url",
    ppprop: "wikibase_item",
    exintro: "1",
    explaintext: "1",
    exchars: String(extractChars),
    titles: options.title,
    format: "json",
    formatversion: "2",
  });

  const page = response.query?.pages?.[0];
  const extract = page?.extract?.trim();
  if (!page || page.missing || !extract) return null;

  const sourceUrl =
    page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;

  return {
    id: `wikipedia:${page.pageid}`,
    source: "wikipedia",
    sourceId: String(page.pageid),
    title: page.title,
    lat: options.lat,
    lon: options.lon,
    datePrecision: "unknown",
    summary: extract,
    sourceExcerpt: extract,
    sourceUrl,
    license: "cc-by-sa-4.0",
    topics: [],
    notability: estimateNotability(extract.length),
    externalIds: {
      wikipediaTitle: page.title,
      ...(page.pageprops?.wikibase_item ? { wikidataQid: page.pageprops.wikibase_item } : {}),
    },
  };
}
