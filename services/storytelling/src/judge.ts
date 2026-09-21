import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The SDK's zodOutputFormat() expects a schema built against the "zod/v4"
// entry point specifically (this package's other zod usage is plain "zod"
// v3) — see zod's own migration subpath, and the type error this avoids.
import { z } from "zod/v4";

/**
 * Layer 3 grounding: an LLM judge (PLAN.md §8.3), asked two things a
 * pattern-matching Layer 2 check can't reliably answer: does any sentence
 * assert something absent from the source, and does the narration actually
 * restate facts in its own words rather than lightly editing the source's
 * sentences (a backstop for `packages/core/grounding`'s n-gram check —
 * PLAN.md's plan explicitly treats the deterministic check as the check of
 * record if this judge turns out not to catch near-verbatim paraphrase
 * reliably; that comparison is exactly what the Milestone 3 eval, once
 * runnable against a real key, is for — see `eval/`).
 *
 * Cheap by design: Haiku, no thinking, structured output, and it runs once
 * per cache entry — not per listen.
 */

export const JUDGE_MODEL = "claude-haiku-4-5-20251001";

const JudgeResultSchema = z.object({
  allFactsSupported: z
    .boolean()
    .describe("true only if every factual claim in the narration is stated in the source excerpt"),
  unsupportedClaim: z
    .string()
    .nullable()
    .describe("the first unsupported claim found, quoted from the narration, or null if allFactsSupported is true"),
  mirrorsSourcePhrasing: z
    .boolean()
    .describe("true if the narration lifts or lightly edits whole sentences from the source rather than restating facts in its own words"),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export interface JudgeNarrationOptions {
  narration: string;
  sourceExcerpt: string;
  /** Injectable for tests; defaults to a real `new Anthropic()` client. */
  client: Pick<Anthropic, "messages">;
}

const JUDGE_SYSTEM_PROMPT =
  "You are a strict fact-checker for a history app. You will be given a SOURCE EXCERPT and a " +
  "NARRATION that is supposed to be a grounded retelling of it. Check two things: (1) whether " +
  "every factual claim in the narration is actually supported by the source excerpt, and (2) " +
  "whether the narration mirrors the source's own sentences rather than restating the facts in " +
  "different words. Be strict — a narration that adds a plausible-sounding but unstated detail " +
  "still counts as unsupported.";

export async function judgeNarration(options: JudgeNarrationOptions): Promise<JudgeResult> {
  const response = await options.client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `SOURCE EXCERPT:\n${options.sourceExcerpt}\n\nNARRATION:\n${options.narration}`,
      },
    ],
    output_config: { format: zodOutputFormat(JudgeResultSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Judge response had no parsed_output (structured output parsing failed)");
  }
  return response.parsed_output;
}
