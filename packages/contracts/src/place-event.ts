import { z } from "zod";

/**
 * The normalised record every content-source adapter emits (PLAN.md §4.1
 * `place_event`). Fields the Postgres schema will add from later milestones
 * (raw payload, fetch bookkeeping, a persisted `dedupe_key`) aren't needed
 * yet because there's still no persistence layer — clustering (Milestone 2)
 * and ranking both operate on in-memory `PlaceEvent[]` per request.
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
 * §8.3, "vagueness preservation") — not used yet by playback, which reads
 * raw excerpts verbatim rather than generating narration, but populated
 * from Milestone 2 onward (Wikidata supplies structured dates) so adapters
 * don't need to be revisited when Milestone 3 needs it.
 */
export const DatePrecision = z.enum(["exact", "year", "decade", "century", "unknown"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

/**
 * Cross-source identity hints (PLAN.md §4.2 "explicit identity links"), used
 * by `packages/core`'s clustering to recognise the same real-world place
 * described by two different sources — e.g. a Wikidata item and an OSM node
 * both tagged with the same QID — without guessing from title/distance
 * alone. An adapter populates whichever of these it has; none are required.
 */
export const ExternalIds = z.object({
  wikidataQid: z.string().optional(),
  wikipediaTitle: z.string().optional(),
  nrhpRefNumber: z.string().optional(),
  osmId: z.string().optional(),
});
export type ExternalIds = z.infer<typeof ExternalIds>;

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
  /**
   * Per-source notability heuristic, 0-1 (PLAN.md §7.4): incoming
   * links/pageviews for Wikipedia, sitelink count for Wikidata, tag
   * richness for OSM, listing significance for NRHP. Not comparable
   * *across* sources in an absolute sense — ranking blends it with
   * `sourceQuality` rather than trusting it alone.
   */
  notability: z.number().min(0).max(1).default(0.3),
  externalIds: ExternalIds.default({}),
});
export type PlaceEvent = z.infer<typeof PlaceEvent>;
