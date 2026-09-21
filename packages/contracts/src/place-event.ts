import { z } from "zod";

/**
 * The normalised record every content-source adapter emits (PLAN.md §4.1
 * `place_event`). This is the M1 subset: fields the Postgres schema will add
 * from M2 onward (dedupe keys, notability, raw payload, fetch bookkeeping)
 * aren't needed yet because there's no persistence layer or cross-source
 * dedup until Milestone 2.
 */

export const SourceId = z.enum(["wikipedia", "wikidata", "osm", "loc", "nrhp"]);
export type SourceId = z.infer<typeof SourceId>;

export const LicenseId = z.enum([
  "cc-by-sa-4.0",
  "cc0",
  "odbl-1.0",
  "public-domain-usgov",
]);
export type LicenseId = z.infer<typeof LicenseId>;

/**
 * How precisely {@link PlaceEvent.dateStart}/{@link PlaceEvent.dateEnd} are
 * known. Drives how vague generated narration is allowed to be (PLAN.md
 * §8.3, "vagueness preservation") — not used yet in M1, which reads raw
 * excerpts verbatim rather than generating narration, but recorded now so
 * adapters don't need to be revisited when M3 needs it.
 */
export const DatePrecision = z.enum(["exact", "year", "decade", "century", "unknown"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const PlaceEvent = z.object({
  /** Stable id, conventionally `${source}:${sourceId}`. */
  id: z.string().min(1),
  source: SourceId,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Great-circle distance from the query point, in meters, when known. */
  distanceM: z.number().min(0).optional(),
  dateStart: z.number().int().optional(),
  dateEnd: z.number().int().optional(),
  datePrecision: DatePrecision,
  /** Verbatim source phrasing for the date/era, e.g. "the early 1900s". */
  eraText: z.string().optional(),
  summary: z.string(),
  /** The grounding substrate (PLAN.md §8.3): narration may only draw on this. */
  sourceExcerpt: z.string(),
  sourceUrl: z.string().url(),
  license: LicenseId,
  topics: z.array(z.string()).default([]),
});
export type PlaceEvent = z.infer<typeof PlaceEvent>;
