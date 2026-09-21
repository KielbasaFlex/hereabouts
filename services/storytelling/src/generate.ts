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

export interface GenerateNarrationOptions {
  place: PlaceEvent;
  mode: Mode;
  spatialFrame: SpatialFrame;
  /** Injectable for tests; defaults to a real `new Anthropic()` client. */
  client: Pick<Anthropic, "messages">;
}

export async function generateNarration(options: GenerateNarrationOptions): Promise<GeneratedNarration> {
  const system = buildSystemPrompt({
    mode: options.mode,
    spatialFrame: options.spatialFrame,
    datePrecision: options.place.datePrecision,
  });

  const response = await options.client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 8000,
    system,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "text", media_type: "text/plain", data: options.place.sourceExcerpt },
            title: options.place.title,
            citations: { enabled: true },
          },
          { type: "text", text: `Write the narration for "${options.place.title}".` },
        ],
      },
    ],
  });

  let narration = "";
  const citations: Citation[] = [];

  for (const block of response.content) {
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

  return { narration: narration.trim(), citations, model: GENERATION_MODEL };
}
