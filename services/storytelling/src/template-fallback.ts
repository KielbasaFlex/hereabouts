import type { PlaceEvent } from "@hereabouts/contracts";

/**
 * The degrade path (PLAN.md §8.3): "on second failure, fall back to a
 * template extractive card (title, date, verbatim excerpt, link) which is
 * grounded by construction. We degrade to boring; we never degrade to
 * invented." No API call — this is just field concatenation, so it can
 * never fail a grounding check (it *is* the source, verbatim).
 */
export function buildTemplateFallback(place: PlaceEvent): string {
  const eraPart = place.eraText ? ` (${place.eraText})` : "";
  return `${place.title}${eraPart}. ${place.sourceExcerpt}`;
}
