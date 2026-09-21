import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent, Story } from "@hereabouts/contracts";
import type { GeneratedNarration } from "./generate.js";
import { GENERATION_MODEL } from "./generate.js";
import { judgeNarration } from "./judge.js";
import { buildTemplateFallback } from "./template-fallback.js";

export interface FinalizedNarration {
  narration: string;
  citations: Story["citations"];
  validationStatus: Story["validationStatus"];
  model: string;
}

export interface FinalizeNarrationOptions {
  place: PlaceEvent;
  /**
   * A narration that has **already passed Layer 2** (deterministic
   * grounding validation) — or `null`, meaning generation failed or every
   * attempt failed Layer 2. This function only runs Layer 3 (the judge) and
   * decides the final fallback; it does not itself validate Layer 2,
   * because how many attempts to make before giving up is a caller policy
   * (`build-story.ts` retries once on a live request; `batch.ts` makes a
   * single attempt per place, since a Batch API resubmission is a whole
   * second batch, not a quick retry).
   */
  groundedGenerated: GeneratedNarration | null;
  client: Pick<Anthropic, "messages">;
}

/**
 * The Layer 3 + fallback half of the storytelling pipeline (PLAN.md §8.3),
 * shared between the live single-story path (`build-story.ts`) and the
 * Batch API pre-generation path (`batch.ts`): judge a Layer-2-passed
 * narration for unsupported claims/source-mirroring, and fall back to the
 * grounded extractive template whenever there's nothing to serve or the
 * judge flags what there is.
 *
 * A Layer 3 judge failure (network error, bad structured output) does not
 * itself invalidate a narration that already passed Layer 2 — Layer 2 is
 * the check of record; the judge is a second opinion layered on top, not a
 * single point of failure the whole pipeline depends on.
 */
export async function finalizeNarration(options: FinalizeNarrationOptions): Promise<FinalizedNarration> {
  if (!options.groundedGenerated) {
    return { narration: buildTemplateFallback(options.place), citations: [], validationStatus: "template_fallback", model: GENERATION_MODEL };
  }

  const generated = options.groundedGenerated;
  const judged = await judgeNarration({
    narration: generated.narration,
    sourceExcerpt: options.place.sourceExcerpt,
    client: options.client,
  }).catch(() => null); // a judge failure doesn't invalidate a Layer-2-passed narration — see doc comment above

  if (judged && (!judged.allFactsSupported || judged.mirrorsSourcePhrasing)) {
    return { narration: buildTemplateFallback(options.place), citations: [], validationStatus: "template_fallback", model: GENERATION_MODEL };
  }

  return { narration: generated.narration, citations: generated.citations, validationStatus: "validated", model: generated.model };
}
