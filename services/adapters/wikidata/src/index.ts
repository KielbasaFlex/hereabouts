import type { DatePrecision, PlaceEvent } from "@hereabouts/contracts";

/**
 * Wikidata SPARQL (WDQS) adapter (PLAN.md §6, SOURCES.md §2).
 *
 * Two independent queries against the same endpoint:
 *
 *  - {@link fetchNearbyItems} — items with coordinates *and* a recorded
 *    inception date (P571), the "Wikidata items with coordinates plus
 *    dates" source PLAN.md asks for. Items without any date are skipped:
 *    Wikidata alone has no prose, so a dateless item has nothing to ground
 *    a story on (SOURCES.md's CC0 licence still makes these valuable once
 *    clustered with a same-place Wikipedia/OSM record, per
 *    `packages/core/dedup`'s date-enrichment step).
 *  - {@link fetchNearestSettlement} — the nearest item typed as a human
 *    settlement (Q486972, covering city/town/village), used by the
 *    Milestone 2 gap-filler for regional framing. This approximates
 *    "what admin area contains this point" via nearest-settlement search
 *    rather than true point-in-polygon containment, which WDQS doesn't
 *    offer cheaply — see fixtures/README.md for the tradeoff.
 *
 * SOURCES.md grades this source **Medium** confidence: never call this from
 * the request path (§13/§7.6 already route it through the gap-filler and a
 * batch-style ingest, not per-poll), and treat timeouts as "no data,"
 * silently degrading rather than failing the whole feed.
 */

export const HEREABOUTS_USER_AGENT =
  "Hereabouts/0.1 (https://hereabouts.app; contact@hereabouts.app)";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

const PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX schema: <http://schema.org/>
`.trim();

export interface LatLon {
  lat: number;
  lon: number;
}

interface SparqlBindingValue {
  value: string;
}

interface SparqlResponse {
  results: { bindings: Record<string, SparqlBindingValue | undefined>[] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function runQuery(
  fetchImpl: typeof fetch,
  userAgent: string,
  query: string,
): Promise<SparqlResponse> {
  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");

  const response = await fetchImpl(url.toString(), {
    headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" },
  });
  if (!response.ok) {
    throw new Error(`Wikidata query failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SparqlResponse;
}

function qidFromUri(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

function parsePoint(wkt: string): LatLon | null {
  // WDQS returns coordinates as WKT: "Point(lon lat)".
  const match = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(wkt);
  if (!match) return null;
  return { lon: Number.parseFloat(match[1] as string), lat: Number.parseFloat(match[2] as string) };
}

/** Maps a `wikibase:timePrecision` code to our coarser {@link DatePrecision} enum. */
function mapPrecision(precision: number): DatePrecision {
  if (precision >= 11) return "exact"; // day or finer
  if (precision >= 9) return "year"; // year or month
  if (precision === 8) return "decade";
  if (precision === 7) return "century";
  return "unknown";
}

function parseYear(isoValue: string): number | null {
  const match = /^(-?\d{1,6})-/.exec(isoValue);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Renders a coarse date into a natural-language era phrase. Unlike
 * Wikipedia's `eraText` (verbatim source wording), this is *synthesized*
 * from a structured precision code — the closest honest English rendering
 * of what Wikidata actually recorded, not a quotation.
 */
function formatEraText(year: number, precision: DatePrecision): string {
  switch (precision) {
    case "exact":
    case "year":
      return String(Math.abs(year)) + (year < 0 ? " BCE" : "");
    case "decade":
      return `the ${Math.floor(year / 10) * 10}s`;
    case "century":
      return `the ${ordinal(Math.floor(year / 100) + 1)} century`;
    default:
      return "an unknown time";
  }
}

export interface FetchNearbyItemsOptions {
  center: LatLon;
  /** Search radius in meters. */
  radiusM: number;
  /** Max number of candidates. Default 20. */
  limit?: number;
  userAgent?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export function buildNearbyItemsQuery(center: LatLon, radiusKm: number, limit: number): string {
  const point = `Point(${center.lon} ${center.lat})`;
  return `${PREFIXES}
SELECT ?item ?itemLabel ?location ?dist ?date ?datePrecision WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?location .
    bd:serviceParam wikibase:center "${point}"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  BIND(geof:distance(?location, "${point}"^^geo:wktLiteral) AS ?dist)
  ?item p:P571 ?inceptionStmt .
  ?inceptionStmt psv:P571 ?inceptionNode .
  ?inceptionNode wikibase:timeValue ?date .
  ?inceptionNode wikibase:timePrecision ?datePrecision .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?dist
LIMIT ${limit}`;
}

/**
 * Fetches nearby Wikidata items with a recorded inception date and
 * normalises them into {@link PlaceEvent} records. Items with no P571
 * value are excluded by the query itself (there would be nothing to
 * narrate). `distanceM` is computed by WDQS from `center`, same caveat as
 * the Wikipedia adapter: recompute against the true position if `center`
 * is a privacy-rounded cell centroid.
 */
export async function fetchNearbyItems(options: FetchNearbyItemsOptions): Promise<PlaceEvent[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? HEREABOUTS_USER_AGENT;
  const radiusKm = clamp(options.radiusM / 1000, 0.01, 250);
  const limit = clamp(options.limit ?? 20, 1, 200);

  const response = await runQuery(fetchImpl, userAgent, buildNearbyItemsQuery(options.center, radiusKm, limit));

  const places: PlaceEvent[] = [];
  for (const binding of response.results.bindings) {
    const itemUri = binding.item?.value;
    const locationWkt = binding.location?.value;
    const dateValue = binding.date?.value;
    const precisionValue = binding.datePrecision?.value;
    if (!itemUri || !locationWkt || !dateValue || precisionValue === undefined) continue;

    const point = parsePoint(locationWkt);
    const year = parseYear(dateValue);
    if (!point || year === null) continue;

    const qid = qidFromUri(itemUri);
    const label = binding.itemLabel?.value ?? qid;
    const precision = mapPrecision(Number.parseInt(precisionValue, 10));
    const eraText = formatEraText(year, precision);
    const distanceM = binding.dist?.value ? Number.parseFloat(binding.dist.value) * 1000 : undefined;

    places.push({
      id: `wikidata:${qid}`,
      source: "wikidata",
      sourceId: qid,
      title: label,
      lat: point.lat,
      lon: point.lon,
      ...(distanceM !== undefined ? { distanceM } : {}),
      dateStart: year,
      datePrecision: precision,
      eraText,
      summary: `${label}, per Wikidata, dates to ${eraText}.`,
      sourceExcerpt: `${label}, per Wikidata, dates to ${eraText}.`,
      sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
      license: "cc0",
      topics: [],
      // No sitelink-count lookup in this query (a second round-trip) — a
      // moderate constant until that enrichment is worth the extra call.
      notability: 0.4,
      externalIds: { wikidataQid: qid },
    });
  }

  return places;
}

export interface FetchNearestSettlementOptions {
  center: LatLon;
  /** Search radius in meters. Default 50km — settlements are sparse relative to point-level places. */
  radiusM?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export interface NearestSettlement {
  qid: string;
  label: string;
  lat: number;
  lon: number;
  distanceM: number;
  wikipediaTitle: string;
}

const HUMAN_SETTLEMENT_QID = "Q486972";

export function buildNearestSettlementQuery(center: LatLon, radiusKm: number): string {
  const point = `Point(${center.lon} ${center.lat})`;
  return `${PREFIXES}
SELECT ?item ?itemLabel ?location ?dist ?articleTitle WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?location .
    bd:serviceParam wikibase:center "${point}"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  BIND(geof:distance(?location, "${point}"^^geo:wktLiteral) AS ?dist)
  ?item wdt:P31/wdt:P279* wd:${HUMAN_SETTLEMENT_QID} .
  ?article schema:about ?item ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?articleTitle .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?dist
LIMIT 1`;
}

/**
 * Finds the nearest Wikidata item classed as a human settlement (city,
 * town, or village — Q486972 and its subclasses) with an English Wikipedia
 * article, for the gap-filler's regional framing (PLAN.md §7.6).
 *
 * This is nearest-settlement search, not true administrative containment:
 * WDQS has no cheap point-in-polygon query, so "the nearest town" stands in
 * for "the town this point is in." See fixtures/README.md for why that's a
 * deliberate, disclosed simplification rather than the full city → county
 * → state cascade PLAN.md sketches.
 */
export async function fetchNearestSettlement(
  options: FetchNearestSettlementOptions,
): Promise<NearestSettlement | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? HEREABOUTS_USER_AGENT;
  const radiusKm = clamp((options.radiusM ?? 50_000) / 1000, 0.01, 250);

  const response = await runQuery(fetchImpl, userAgent, buildNearestSettlementQuery(options.center, radiusKm));
  const binding = response.results.bindings[0];
  if (!binding) return null;

  const itemUri = binding.item?.value;
  const locationWkt = binding.location?.value;
  const articleTitle = binding.articleTitle?.value;
  if (!itemUri || !locationWkt || !articleTitle) return null;

  const point = parsePoint(locationWkt);
  if (!point) return null;

  return {
    qid: qidFromUri(itemUri),
    label: binding.itemLabel?.value ?? articleTitle,
    lat: point.lat,
    lon: point.lon,
    distanceM: binding.dist?.value ? Number.parseFloat(binding.dist.value) * 1000 : 0,
    wikipediaTitle: articleTitle,
  };
}
