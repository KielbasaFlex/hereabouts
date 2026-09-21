import type { PlaceEvent } from "@hereabouts/contracts";
import { haversine, type LatLon } from "@hereabouts/core/geo";
import { classifyTopics } from "@hereabouts/core/topics";
import { SAMPLE_NRHP_RECORDS, type NrhpRecord } from "./dataset.js";

/**
 * National Register of Historic Places adapter (PLAN.md §6, SOURCES.md §5).
 *
 * Unlike the other three adapters, NRHP is architecturally a **bulk
 * dataset, not a live per-request API** — PLAN.md's own design calls for a
 * periodic bulk load into Postgres, queried locally with zero upstream
 * latency. There's no Postgres wiring yet (deferred past Milestone 2), so
 * `queryNearby` does the same *kind* of thing — local, in-memory spatial
 * filtering — against a small placeholder dataset (`./dataset.ts`) standing
 * in for that bulk table. Swapping in the real dataset later is a `dataset`
 * argument, not a rewrite of this module's query logic.
 */

export { type NrhpRecord } from "./dataset.js";
export type { LatLon };

export interface QueryNearbyOptions {
  center: LatLon;
  radiusM: number;
  /** Defaults to the bundled placeholder sample — see dataset.ts's caveat. */
  dataset?: readonly NrhpRecord[];
}

function estimateNotability(record: NrhpRecord): number {
  // Being NRHP-listed at all is a real notability signal (distinct from
  // OSM's tag-richness heuristic) — a baseline reflecting the listing
  // itself, boosted when a significance note gives us more to say.
  return record.significance ? 0.75 : 0.6;
}

function buildExcerpt(record: NrhpRecord): string {
  const parts: string[] = [`${record.name} is listed on the National Register of Historic Places`];
  if (record.listedYear) parts.push(`, listed in ${record.listedYear}`);
  const sentence = `${parts.join("")}.`;
  return record.significance ? `${sentence} ${record.significance}` : sentence;
}

/**
 * Filters the (placeholder) dataset to records within `radiusM` of `center`
 * and normalises them into {@link PlaceEvent} records, nearest first.
 */
export function queryNearby(options: QueryNearbyOptions): PlaceEvent[] {
  const dataset = options.dataset ?? SAMPLE_NRHP_RECORDS;

  return dataset
    .map((record) => ({ record, distanceM: haversine(options.center, record) }))
    .filter(({ distanceM }) => distanceM <= options.radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .map(({ record, distanceM }): PlaceEvent => {
      const excerpt = buildExcerpt(record);
      return {
        id: `nrhp:${record.refNumber}`,
        source: "nrhp",
        sourceId: record.refNumber,
        title: record.name,
        lat: record.lat,
        lon: record.lon,
        distanceM,
        ...(record.listedYear !== undefined ? { dateStart: record.listedYear } : {}),
        datePrecision: record.listedYear !== undefined ? "year" : "unknown",
        summary: excerpt,
        sourceExcerpt: excerpt,
        // Illustrative URL pattern, not a verified NPGallery deep-link
        // scheme — see fixtures/README.md.
        sourceUrl: `https://npgallery.nps.gov/NRHP/AssetDetail?assetID=${encodeURIComponent(record.refNumber)}`,
        license: "public-domain-usgov",
        topics: classifyTopics(`${record.name} ${record.significance ?? ""}`),
        notability: estimateNotability(record),
        externalIds: { nrhpRefNumber: record.refNumber },
        isRegional: false,
      };
    });
}
