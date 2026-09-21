import { z } from "zod";
import { PlaceEvent } from "./place-event.js";

/**
 * Travel mode, shared between `packages/core`'s classifier and the API
 * contract. Kept as its own zod enum here (rather than importing the core
 * package's type) so `contracts` stays the dependency-free leaf of the
 * monorepo — `core` depends on `contracts` (for `PlaceEvent`, since
 * Milestone 2's dedup/rank modules operate on it), and both apps depend on
 * both, but nothing depends on an app and nothing contracts depends on core.
 */
export const Mode = z.enum(["stationary", "walking", "biking", "driving"]);
export type Mode = z.infer<typeof Mode>;

/**
 * The `/feed` request (PLAN.md §5). The client sends its live position
 * directly — the H3-cell rounding described in PLAN.md §13 for
 * privacy-preserving upstream queries is a server-side concern applied
 * before any third-party call is made (see `apps/api`'s adapter calls), not
 * a client-side one.
 */
export const FeedRequest = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  headingDeg: z.number().min(0).max(360).default(0),
  speedMps: z.number().min(0).default(0),
  mode: Mode.default("walking"),
  /** Place ids already served this trip, so the feed doesn't repeat them. */
  heardIds: z.array(z.string()).default([]),
  /**
   * Topic filter preference (PLAN.md's V1 topic filters — a ranking weight,
   * never a hard hide). No UI sets this yet (that's Milestone 4); it's
   * threaded through the contract and ranking now so adding that UI later
   * is additive, not a scoring-code change.
   */
  topics: z.array(z.string()).default([]),
});
export type FeedRequest = z.infer<typeof FeedRequest>;

export const FeedResponse = z.object({
  places: z.array(PlaceEvent),
});
export type FeedResponse = z.infer<typeof FeedResponse>;
