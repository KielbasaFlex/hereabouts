import type { PlaceEvent } from "@hereabouts/contracts";
import { haversine, type LatLon } from "@hereabouts/core/geo";
import { classifyTopics } from "@hereabouts/core/topics";

/**
 * OpenStreetMap via Overpass API adapter (PLAN.md §6, SOURCES.md §3):
 * `historic=*`, `memorial=*`, and `heritage=*` tagged nodes/ways near a
 * point.
 *
 * OSM has no prose, so `sourceExcerpt` is synthesized strictly from tags
 * actually present on the element — never invented, and thin by design.
 * When an element carries a `wikidata`/`wikipedia` tag, that's captured in
 * `externalIds` precisely so `packages/core/dedup` can cluster it with the
 * richer Wikipedia/Wikidata record for the same place and let *that*
 * record's prose win (PLAN.md §4.2's "preferred record chosen by source
 * quality"). An unnamed element (no `name` tag) is skipped: there's nothing
 * to title a story with, and OSM's own tagging norms treat `name` as
 * optional for exactly the memorial/historic markers that lack a discrete
 * public name.
 *
 * This module depends on `@hereabouts/core` only for `haversine` — unlike
 * the Wikipedia/Wikidata adapters, Overpass never returns a distance
 * itself, and duplicating that math locally isn't worth it for a
 * server-only package (no bundle-size concern the way `apps/web` has one).
 *
 * **Public instance is dev-only** (SOURCES.md §3): the default endpoint
 * below explicitly forbids relying on it as an application backend.
 * Production traffic needs a self-hosted Overpass instance or a regional
 * extract — see PLAN.md §16.3.
 */

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

export const HEREABOUTS_USER_AGENT =
  "Hereabouts/0.1 (https://hereabouts.app; contact@hereabouts.app)";

export type { LatLon };

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildQuery(center: LatLon, radiusM: number): string {
  const around = `around:${radiusM},${center.lat},${center.lon}`;
  const filters = ["historic", "memorial", "heritage"];
  const clauses = filters.flatMap((key) => [`  node(${around})[${key}];`, `  way(${around})[${key}];`]);
  return `[out:json][timeout:25];\n(\n${clauses.join("\n")}\n);\nout center;`;
}

/**
 * Builds a factual sentence strictly from present OSM tags — no fact
 * appears here that isn't a literal tag value on the element.
 */
function buildExcerpt(title: string, tags: Record<string, string>): string {
  const parts: string[] = [];
  if (tags.historic) parts.push(`tagged in OpenStreetMap as historic=${tags.historic}`);
  if (tags.memorial) parts.push(`tagged as a memorial (memorial=${tags.memorial})`);
  if (tags.heritage) parts.push(`with a heritage designation of ${tags.heritage}`);
  if (parts.length === 0) return `${title} is tagged in OpenStreetMap, with no further descriptive tags present.`;
  return `${title} is ${parts.join(", ")}.`;
}

function parseWikipediaTag(value: string): string {
  // OSM's `wikipedia` tag is conventionally "lang:Title" — strip the lang prefix if present.
  const colonIndex = value.indexOf(":");
  return colonIndex === -1 ? value : value.slice(colonIndex + 1);
}

function estimateNotability(tagCount: number): number {
  // Tag-richness heuristic (PLAN.md §7.4): more descriptive tagging
  // correlates loosely with a more substantial, better-curated feature.
  // Capped low — OSM tag richness is a weaker signal than Wikipedia prose.
  return Math.min(0.5, 0.15 + tagCount * 0.05);
}

export interface FetchNearbyOptions {
  center: LatLon;
  /** Search radius in meters. */
  radiusM: number;
  endpoint?: string;
  userAgent?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetches historic/memorial/heritage-tagged OSM elements near `center` and
 * normalises them into {@link PlaceEvent} records. `distanceM` is computed
 * locally via haversine against `center` — same caveat as the other
 * adapters if `center` is a privacy-rounded cell centroid rather than the
 * caller's true position.
 */
export async function fetchNearbyPlaces(options: FetchNearbyOptions): Promise<PlaceEvent[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? HEREABOUTS_USER_AGENT;
  const endpoint = options.endpoint ?? OVERPASS_ENDPOINT;
  const radiusM = clamp(Math.round(options.radiusM), 1, 50_000);

  const query = buildQuery(options.center, radiusM);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "User-Agent": userAgent, "Content-Type": "text/plain" },
    body: query,
  });
  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as OverpassResponse;

  const places: PlaceEvent[] = [];
  for (const element of data.elements ?? []) {
    const tags = element.tags ?? {};
    const title = tags.name;
    if (!title) continue; // nothing to title a story with

    const point = element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : element.center;
    if (!point) continue;

    const excerpt = buildExcerpt(title, tags);
    const osmId = `${element.type}/${element.id}`;

    places.push({
      id: `osm:${osmId}`,
      source: "osm",
      sourceId: osmId,
      title,
      lat: point.lat,
      lon: point.lon,
      distanceM: haversine(options.center, point),
      datePrecision: "unknown",
      summary: excerpt,
      sourceExcerpt: excerpt,
      sourceUrl: `https://www.openstreetmap.org/${osmId}`,
      license: "odbl-1.0",
      // Classified from `excerpt` rather than the raw tags directly — the
      // excerpt already renders each tag's value as English ("historic=fort"
      // etc.), so the same keyword vocabulary that reads Wikipedia/Wikidata
      // prose works here too without a separate tag-to-topic mapping.
      topics: classifyTopics(`${title} ${excerpt}`),
      notability: estimateNotability(Object.keys(tags).length),
      externalIds: {
        osmId,
        ...(tags.wikidata ? { wikidataQid: tags.wikidata } : {}),
        ...(tags.wikipedia ? { wikipediaTitle: parseWikipediaTag(tags.wikipedia) } : {}),
      },
      isRegional: false,
    });
  }

  return places;
}
