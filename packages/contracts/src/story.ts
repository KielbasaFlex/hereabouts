import { z } from "zod";

/**
 * Generated narration (PLAN.md §8). A `Story` is the output of Milestone
 * 3's pipeline: grounded, length-scaled, voiced narration for one
 * `PlaceEvent`, cached by `(placeId, lengthBucket, promptVersion)` — the
 * shared cache PLAN.md §4.4/§8.4 calls the main cost control.
 */

/**
 * Length scaling is per travel mode (PLAN.md §8.2), but "stationary" and
 * "walking" share a bucket — there's no separate stationary-length target
 * in the brief, and a stopped user is narratively closer to a walker than
 * to anything else.
 */
export const LengthBucket = z.enum(["driving", "biking", "walking"]);
export type LengthBucket = z.infer<typeof LengthBucket>;

/**
 * One cited span from the source excerpt (PLAN.md §8.3 Layer 1). A
 * deliberately narrower shape than the Citations API's own `char_location`
 * object — `document_index`/`document_title` are dropped because a Story
 * always cites exactly one document (the place's own `sourceExcerpt`), so
 * they'd be constant and redundant on every entry.
 */
export const Citation = z.object({
  citedText: z.string(),
  startCharIndex: z.number().int().min(0),
  endCharIndex: z.number().int().min(0),
});
export type Citation = z.infer<typeof Citation>;

/**
 * `validated`: passed all three grounding layers and is served as
 * generated. `template_fallback`: failed grounding twice (or the judge
 * flagged it) and degraded to the deterministic extractive card (PLAN.md
 * §8.3 — "we degrade to boring; we never degrade to invented").
 */
export const ValidationStatus = z.enum(["validated", "template_fallback"]);
export type ValidationStatus = z.infer<typeof ValidationStatus>;

export const Story = z.object({
  placeId: z.string(),
  lengthBucket: LengthBucket,
  narration: z.string(),
  citations: z.array(Citation),
  validationStatus: ValidationStatus,
  model: z.string(),
  promptVersion: z.string(),
  /** Whether this response came from the shared cache rather than a fresh generation. */
  cached: z.boolean(),
});
export type Story = z.infer<typeof Story>;
