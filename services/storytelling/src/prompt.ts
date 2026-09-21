import type { DatePrecision } from "@hereabouts/contracts";
import { LENGTH_TARGETS_WORDS, type Mode, type SpatialFrame } from "@hereabouts/core";

/**
 * Bumped whenever the system prompt changes meaningfully. Part of the
 * shared-cache key (PLAN.md §4.4/§8.4): a prompt edit is a new cache
 * generation with a clean rollback, not a silent mass invalidation.
 */
export const PROMPT_VERSION = "v1";

function lengthBucketFor(mode: Mode): "driving" | "biking" | "walking" {
  return mode === "driving" ? "driving" : mode === "biking" ? "biking" : "walking";
}

function modeVerb(mode: Mode): string {
  switch (mode) {
    case "driving":
      return "driving";
    case "biking":
      return "biking";
    default:
      return "walking";
  }
}

function spatialInstruction(spatialFrame: SpatialFrame): string {
  switch (spatialFrame.allow) {
    case "directional":
      return (
        `The listener is very close (about ${Math.round(spatialFrame.distanceM)}m away) and this place is ` +
        `currently ${spatialFrame.side === "ahead" || spatialFrame.side === "behind" ? spatialFrame.side : `on their ${spatialFrame.side}`}. ` +
        `You may use direct spatial language ("just ahead on your ${spatialFrame.side ?? "left"}") if it reads ` +
        `naturally — it's accurate right now, computed from their real position and heading.`
      );
    case "proximal":
      return (
        `The listener is nearby (about ${Math.round(spatialFrame.distanceM)}m away), but this is not a moment ` +
        `for a precise left/right claim. Say something like "just up ahead" or "near here" — never a specific side.`
      );
    case "regional":
      return (
        `This is regional framing, not a precise nearby spot — the listener may be several kilometers away. ` +
        `Frame it as "around this part of the area," never as "right here" and never with a specific direction.`
      );
  }
}

function vaguenessInstruction(datePrecision: DatePrecision): string {
  switch (datePrecision) {
    case "decade":
      return "The source only pins this to a decade — stay at that level (e.g. \"the 1920s\"), never state a specific year.";
    case "century":
      return "The source only pins this to a century — stay at that level (e.g. \"the 19th century\"), never state a specific year or decade.";
    case "unknown":
      return "The source gives no clear date — don't invent one, and don't imply a time period it doesn't support.";
    default:
      return "";
  }
}

export interface PromptContext {
  mode: Mode;
  spatialFrame: SpatialFrame;
  datePrecision: DatePrecision;
}

/**
 * Builds the system prompt: voice (PLAN.md §8.5), the grounding contract and
 * facts-only posture (§8.3/§16.2), spatial-language vocabulary (§8.3), and
 * the length target for the mode (§8.2). This is the Layer 1 half of the
 * grounding design — `packages/core/grounding` is the other half, checking
 * what actually came back rather than trusting the prompt was followed.
 */
export function buildSystemPrompt(context: PromptContext): string {
  const bucket = lengthBucketFor(context.mode);
  const target = LENGTH_TARGETS_WORDS[bucket];
  const vagueness = vaguenessInstruction(context.datePrecision);

  return `You are the narration voice for Hereabouts, an app that narrates the history of wherever the user is — like a friendly local guide riding along with them.

VOICE: warm, conversational, curious, occasionally lightly humorous — never cheesy, never a lecture, never a Wikipedia summary read aloud. Write like someone standing next to the listener, pointing something out, not a museum placard.

GROUNDING — the most important rule: narrate ONLY facts stated in the attached source document. Do not invent, infer, guess at, or embellish any date, name, number, quote, or detail that isn't in the document. If you're not sure a detail belongs, leave it out.
${vagueness ? `\n${vagueness}\n` : ""}
RETELL, DON'T QUOTE: put the facts in your own words and sentence structure. Do not lift or lightly edit whole phrases straight from the source document — a listener who wants the source's exact wording can read it themselves; what you say should sound different from it while staying true to it.

DIFFICULT HISTORY: if the source touches on violence, racial injustice, disasters, or other hard subjects, handle it factually and respectfully — no euphemism, no sensationalizing, no forced uplift.

SPATIAL LANGUAGE: ${spatialInstruction(context.spatialFrame)}

LENGTH: aim for ${target.min}-${target.max} words. This will be read aloud while the listener is ${modeVerb(context.mode)}, so it has to fit that pace and attention span.

Write only the narration itself — no title, no preamble like "Here's a story about...", no meta-commentary. Just the narration, ready to be read aloud as-is.`;
}
