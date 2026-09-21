import type Anthropic from "@anthropic-ai/sdk";
import type { Citation, PlaceEvent } from "@hereabouts/contracts";
import type { Mode, SpatialFrame } from "@hereabouts/core";
import { buildSystemPrompt } from "./prompt.js";

/**
 * Layer 1 generation (PLAN.md §8.3): the source excerpt goes in as a
 * `document` content block with `citations: { enabled: true }`. Claude
 * returns text interleaved with citation spans pointing back into that
 * document — traceability is a property of generation, not a
 * reconstruction after the fact, and it's what lets the text card render
 * "every narrated fact can be traced to a cited source excerpt" directly
 * from what the model already returned.
 *
 * Citations are structural provenance for what *is* cited, not proof
 * against hallucination in uncited connective text — that's exactly why
 * this is Layer 1 of three, not the whole grounding story.
 */

export const GENERATION_MODEL = "claude-sonnet-5";

export interface GeneratedNarration {
  narration: string;
  citations: Citation[];
  model: string;
}

export interface NarrationRequestOptions {
  place: PlaceEvent;
  mode: Mode;
  spatialFrame: SpatialFrame;
}

/**
 * Builds the `messages.create` request body for one place — shared between
 * the live single-story path below and `batch.ts`'s Batch API pre-generation
 * (each batch request's `params` is exactly this shape, per the Batches
 * API's "same request body as `messages.create`, minus streaming"), so the
 * two paths can never drift apart on prompt/citations/effort construction.
 */
export function buildGenerationRequestParams(options: NarrationRequestOptions) {
  const system = buildSystemPrompt({
    mode: options.mode,
    spatialFrame: options.spatialFrame,
    datePrecision: options.place.datePrecision,
  });

  return {
    model: GENERATION_MODEL,
    max_tokens: 8000,
    system,
    output_config: { effort: "low" as const },
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "document" as const,
            source: { type: "text" as const, media_type: "text/plain" as const, data: options.place.sourceExcerpt },
            title: options.place.title,
            citations: { enabled: true },
          },
          { type: "text" as const, text: `Write the narration for "${options.place.title}".` },
        ],
      },
    ],
  };
}

export interface GenerateNarrationOptions extends NarrationRequestOptions {
  /** Injectable for tests; defaults to a real `new Anthropic()` client. */
  client: Pick<Anthropic, "messages">;
}

/**
 * Extracts narration text + citation spans from a `Message`'s content
 * blocks — shared by the live path (below) and `batch.ts`, since a batch
 * result's `.result.message` is the same `Message` shape a direct
 * `messages.create` call returns.
 */
export function extractNarration(content: Anthropic.Message["content"]): { narration: string; citations: Citation[] } {
  let narration = "";
  const citations: Citation[] = [];

  for (const block of content) {
    if (block.type !== "text") continue; // skip thinking blocks (adaptive thinking is on by default for this model)
    narration += block.text;
    for (const citation of block.citations ?? []) {
      if (citation.type === "char_location") {
        citations.push({
          citedText: citation.cited_text,
          startCharIndex: citation.start_char_index,
          endCharIndex: citation.end_char_index,
        });
      }
    }
  }

  return { narration: narration.trim(), citations };
}

export async function generateNarration(options: GenerateNarrationOptions): Promise<GeneratedNarration> {
  const response = await options.client.messages.create(buildGenerationRequestParams(options));
  const { narration, citations } = extractNarration(response.content);
  return { narration, citations, model: GENERATION_MODEL };
}
