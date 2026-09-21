import type { PlaceEvent, SourceId } from "@hereabouts/contracts";
import { haversine } from "../geo/index.js";

/**
 * Cross-source deduplication (PLAN.md §4.2). The same courthouse can show up
 * as a Wikipedia article, a Wikidata item, and an OSM node in one candidate
 * pool — narrating it three times is the fastest way this product feels
 * broken. Resolution order:
 *
 *  1. Explicit identity links: two records sharing a Wikidata QID, an NRHP
 *     reference number, or a Wikipedia title (via `externalIds`) are the
 *     same place, regardless of distance or title spelling.
 *  2. Fuzzy fallback: within {@link FUZZY_MAX_DISTANCE_M} *and* title
 *     similarity at or above {@link FUZZY_MIN_TITLE_SIMILARITY}.
 *
 * One `PlaceEvent` never ends up in more than one cluster.
 */

export interface PlaceCluster {
  /** The preferred member's id — stable as long as that member stays preferred. */
  id: string;
  /** The best-quality record in the cluster (PLAN.md §4.2 "source quality"). */
  preferred: PlaceEvent;
  /** Every other record describing the same place, kept as supporting excerpts. */
  supporting: PlaceEvent[];
}

export const FUZZY_MAX_DISTANCE_M = 75;
export const FUZZY_MIN_TITLE_SIMILARITY = 0.55;

/**
 * Source quality ordering used only to pick a cluster's preferred record:
 * richer prose (Wikipedia, historic-newspaper text) beats a tag-derived OSM
 * stub or a bare Wikidata item. This is unrelated to {@link
 * import("../rank/index.js").SOURCE_QUALITY_SCORE}, which scores *ranking*
 * rather than *cluster preference*, though the two orderings agree.
 */
const SOURCE_PREFERENCE_RANK: Record<SourceId, number> = {
  wikipedia: 5,
  loc: 4,
  nrhp: 3,
  wikidata: 2,
  osm: 1,
};

function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

/**
 * Dice's coefficient over character bigrams: a small, dependency-free
 * stand-in for trigram similarity, returning 1 for identical strings and 0
 * for strings sharing no bigrams. Two empty strings are treated as
 * identical (similarity 1) since there's nothing to disagree about.
 */
export function titleSimilarity(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 && gramsB.size === 0) return 1;
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) intersection++;
  return (2 * intersection) / (gramsA.size + gramsB.size);
}

function sameIdentity(a: PlaceEvent, b: PlaceEvent): boolean {
  const idsA = a.externalIds;
  const idsB = b.externalIds;
  if (idsA.wikidataQid && idsA.wikidataQid === idsB.wikidataQid) return true;
  if (idsA.nrhpRefNumber && idsA.nrhpRefNumber === idsB.nrhpRefNumber) return true;
  if (idsA.wikipediaTitle && idsA.wikipediaTitle === idsB.wikipediaTitle) return true;
  if (idsA.osmId && idsA.osmId === idsB.osmId) return true;
  return false;
}

function isFuzzyMatch(a: PlaceEvent, b: PlaceEvent): boolean {
  if (haversine(a, b) > FUZZY_MAX_DISTANCE_M) return false;
  return titleSimilarity(a.title, b.title) >= FUZZY_MIN_TITLE_SIMILARITY;
}

function pickPreferred(members: readonly PlaceEvent[]): PlaceEvent {
  // Array.prototype.sort is stable (ES2019+), so ties keep arrival order.
  const [best] = [...members].sort(
    (x, y) => SOURCE_PREFERENCE_RANK[y.source] - SOURCE_PREFERENCE_RANK[x.source],
  );
  // members is guaranteed non-empty by every call site below.
  return best as PlaceEvent;
}

/**
 * Clusters candidate places that describe the same real-world place. Order
 * of the input has no effect on the resulting clusters' membership, only on
 * tie-breaks within {@link pickPreferred}.
 */
export function clusterPlaces(places: readonly PlaceEvent[]): PlaceCluster[] {
  const clusters: PlaceEvent[][] = [];

  for (const place of places) {
    const existingCluster = clusters.find((cluster) =>
      cluster.some((member) => sameIdentity(member, place) || isFuzzyMatch(member, place)),
    );
    if (existingCluster) {
      existingCluster.push(place);
    } else {
      clusters.push([place]);
    }
  }

  return clusters.map((members) => {
    const preferred = pickPreferred(members);
    return {
      id: preferred.id,
      preferred,
      supporting: members.filter((member) => member.id !== preferred.id),
    };
  });
}
