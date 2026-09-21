import type Anthropic from "@anthropic-ai/sdk";
import type { LengthBucket, PlaceEvent, Story } from "@hereabouts/contracts";
import { validateGrounding, type Mode, type SpatialFrame } from "@hereabouts/core";
import type { StoryCache } from "./cache.js";
import { finalizeNarration } from "./finalize.js";
import { generateNarration } from "./generate.js";
import { PROMPT_VERSION } from "./prompt.js";

function toLengthBucket(mode: Mode): LengthBucket {
  if (mode === "driving") return "driving";
  if (mode === "biking") return "biking";
  return "walking"; // walking and stationary share a bucket — see packages/contracts/src/story.ts
}

export interface BuildStoryOptions {
  place: PlaceEvent;
  mode: Mode;
  spatialFrame: SpatialFrame;
  cache: StoryCache;
  client: Pick<Anthropic, "messages">;
}

/**
 * The Milestone 3 pipeline end to end (PLAN.md §8): cache lookup, then
 * generate → validate (Layer 2) → regenerate once on failure → judge
 * (Layer 3) → template fallback on any remaining failure, then cache
 * whatever was actually served (never the failed attempt).
 *
 * A Layer 3 judge failure (network error, bad structured output) does not
 * itself invalidate a narration that already passed Layer 2 — Layer 2 is
 * the check of record; the judge is a second opinion layered on top, not a
 * single point of failure the whole pipeline depends on.
 */
export async function buildStory(options: BuildStoryOptions): Promise<Story> {
  const lengthBucket = toLengthBucket(options.mode);
  const cacheKey = { placeId: options.place.id, lengthBucket, promptVersion: PROMPT_VERSION };

  const cached = options.cache.get(cacheKey);
  if (cached) {
    return { placeId: options.place.id, lengthBucket, promptVersion: PROMPT_VERSION, cached: true, ...cached };
  }

  async function attempt() {
    // A thrown error (rate limit, network blip) is treated the same as a
    // failed grounding check, not surfaced separately: either way, this
    // attempt didn't produce a servable narration, and the same
    // regenerate-once-then-fall-back-to-template policy should apply. The
    // alternative — letting a transient API error bubble all the way up to
    // a 502 — would abandon a listener over exactly the kind of blip
    // PLAN.md §16.3 already asks other parts of this app to degrade
    // through silently.
    let generated;
    try {
      generated = await generateNarration({
        place: options.place,
        mode: options.mode,
        spatialFrame: options.spatialFrame,
        client: options.client,
      });
    } catch (error) {
      console.warn("storytelling: generation attempt failed:", error);
      return null;
    }
    const report = validateGrounding({
      narration: generated.narration,
      sourceExcerpt: options.place.sourceExcerpt,
      datePrecision: options.place.datePrecision,
      spatialFrame: options.spatialFrame,
      mode: options.mode,
    });
    return report.passed ? generated : null;
  }

  let generated = await attempt();
  if (!generated) generated = await attempt(); // regenerate once, per PLAN.md §8.3

  const finalized = await finalizeNarration({ place: options.place, groundedGenerated: generated, client: options.client });

  options.cache.set(cacheKey, finalized);

  return { placeId: options.place.id, lengthBucket, promptVersion: PROMPT_VERSION, cached: false, ...finalized };
}
