import type { DatePrecision } from "@hereabouts/contracts";
import type { Mode } from "../mode/index.js";
import type { SpatialFrame } from "../spatial-frame/index.js";

/**
 * Layer 2 grounding: deterministic, pure validators (PLAN.md §8.3). Cheapest
 * and most reliable of the three layers — no API call, no ambiguity about
 * what "passed" means. A narration that fails any check here is never
 * served as generated; `services/storytelling` regenerates once, then
 * degrades to the template extractive card.
 *
 * These are pattern-based, not a real NLP pipeline — regex over English
 * prose, with the false-positive/negative risk that implies. That's an
 * accepted tradeoff for a fast, dependency-free, fully-deterministic first
 * line of defense; Layer 3 (an LLM judge) exists precisely to catch what
 * pattern-matching misses, not to replace it.
 */

export interface GroundingCheckResult {
  passed: boolean;
  /** Present only when `passed` is false — what specifically failed, and why. */
  reason?: string;
}

function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Numeral/date check
// ---------------------------------------------------------------------------

const NUMERAL_PATTERN = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Every year, count, or measurement number in the narration must appear
 * (as a bare digit sequence, comma-insensitive) in the source excerpt.
 * Catches the classic invented-date/invented-count failure.
 */
export function checkNumeralsAndDates(narration: string, sourceExcerpt: string): GroundingCheckResult {
  const narrationNumerals = new Set(narration.match(NUMERAL_PATTERN) ?? []);
  const sourceDigitsOnly = sourceExcerpt.replace(/,/g, "");

  const ungrounded = [...narrationNumerals].filter((numeral) => {
    const bare = numeral.replace(/,/g, "");
    return !sourceExcerpt.includes(numeral) && !sourceDigitsOnly.includes(bare);
  });

  if (ungrounded.length > 0) {
    return { passed: false, reason: `numeral(s) not present in source excerpt: ${ungrounded.join(", ")}` };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Entity check
// ---------------------------------------------------------------------------

/** Common sentence-initial words that produce false "entity" matches when capitalized. */
const ENTITY_STOPWORDS = new Set([
  "The",
  "This",
  "That",
  "These",
  "Those",
  "It",
  "In",
  "On",
  "At",
  "A",
  "An",
  "As",
  "By",
  "For",
  "From",
  "Its",
  "Today",
  "Nearby",
  "Around",
  "According",
]);

// A capitalized word, followed by one or more repetitions of either another
// capitalized word or a lowercase connector ("of"/"the"/"and") — matches
// "Tampa Theatre", "Bank of America", "Fort Sam Houston", but not a single
// capitalized word followed by ordinary lowercase prose.
const ENTITY_PATTERN = /\b[A-Z][a-zA-Z']*(?:\s+(?:[A-Z][a-zA-Z']*|of|the|and))+\b/g;

/**
 * Capitalized multi-word spans (proper-noun-shaped phrases) in the
 * narration must appear in the source excerpt, modulo a stoplist of common
 * sentence-initial capitals. Approximate by design — see the module-level
 * note on why this is one layer among several, not a complete NER pipeline.
 */
export function checkEntities(narration: string, sourceExcerpt: string): GroundingCheckResult {
  const candidates = narration.match(ENTITY_PATTERN) ?? [];
  const ungrounded = candidates.filter((phrase) => {
    const firstWord = phrase.split(/\s+/)[0];
    if (firstWord && ENTITY_STOPWORDS.has(firstWord)) return false;
    return !sourceExcerpt.includes(phrase);
  });

  if (ungrounded.length > 0) {
    return { passed: false, reason: `entity/entities not present in source excerpt: ${ungrounded.join(", ")}` };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Vagueness preservation
// ---------------------------------------------------------------------------

// A 4-digit year NOT immediately followed by "s" (so "1920s" — decade
// phrasing — doesn't trip this, but a bare "1926" does).
const BARE_YEAR_PATTERN = /\b(1[0-9]{3}|20[0-9]{2})\b(?!s)/;

/**
 * If the source's date precision is coarser than "year", the narration
 * must not sharpen it into a specific year. Enforces PLAN.md §8.3's "if the
 * source is vague, the narration stays vague" as code, not a prompt wish.
 */
export function checkVaguenessPreserved(narration: string, datePrecision: DatePrecision): GroundingCheckResult {
  if (datePrecision === "exact" || datePrecision === "year" || datePrecision === "unknown") {
    // "unknown" has no known precision to violate — nothing to check here.
    return { passed: true };
  }
  if (BARE_YEAR_PATTERN.test(narration)) {
    return {
      passed: false,
      reason: `narration states a specific year, but the source's date precision is only "${datePrecision}"`,
    };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Spatial language check
// ---------------------------------------------------------------------------

const DIRECTIONAL_PHRASES = [
  "on your left",
  "on your right",
  "to your left",
  "to your right",
  "just ahead",
  "right ahead",
  "up ahead",
  "ahead on your",
  "behind you",
  "coming up on",
];

/**
 * Directional spatial language ("on your left", "just ahead") is only
 * accurate when computed from real position and heading — PLAN.md §8.3.
 * The generation prompt is told the same rule (`services/storytelling`),
 * but this check is what actually enforces it.
 */
export function checkSpatialLanguage(narration: string, spatialFrame: SpatialFrame): GroundingCheckResult {
  if (spatialFrame.allow === "directional") return { passed: true };

  const lower = narration.toLowerCase();
  const found = DIRECTIONAL_PHRASES.filter((phrase) => lower.includes(phrase));
  if (found.length > 0) {
    return {
      passed: false,
      reason: `directional language (${found.join(", ")}) used, but spatial frame only allows "${spatialFrame.allow}"`,
    };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Phrase-mirroring (n-gram overlap) check — PLAN.md §16.2's facts-only posture
// ---------------------------------------------------------------------------

const NGRAM_SIZE = 7;

/**
 * Common historical-register constructions that would otherwise produce
 * false positives — sharing one of these with the source is about the
 * facts, not the source's expression. Checked as a substring of the
 * matched n-gram, so e.g. "was built in 1926 and" still exempts on "was
 * built in".
 */
const NGRAM_STOPLIST = [
  "was built in",
  "was completed in",
  "was founded in",
  "was established in",
  "is listed on the national register",
  "is located in",
  "was designed by",
  "is named after",
];

function isStoplisted(ngram: string): boolean {
  return NGRAM_STOPLIST.some((phrase) => ngram.includes(phrase));
}

function wordNgrams(text: string, n: number): Set<string> {
  const words = normalizeWords(text).split(" ").filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    grams.add(words.slice(i, i + n).join(" "));
  }
  return grams;
}

/**
 * The narration must not lift the source's phrasing (facts-only posture,
 * PLAN.md §16.2): fails if any contiguous {@link NGRAM_SIZE}-word sequence
 * in the narration also appears verbatim in the source excerpt, excluding
 * common factual boilerplate.
 */
export function checkPhraseOverlap(narration: string, sourceExcerpt: string): GroundingCheckResult {
  const sourceGrams = wordNgrams(sourceExcerpt, NGRAM_SIZE);
  const narrationGrams = wordNgrams(narration, NGRAM_SIZE);

  const overlapping = [...narrationGrams].filter((gram) => sourceGrams.has(gram) && !isStoplisted(gram));
  if (overlapping.length > 0) {
    return { passed: false, reason: `narration mirrors source phrasing: "${overlapping[0]}"` };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Length check
// ---------------------------------------------------------------------------

/** Word-count targets per PLAN.md §8.2. "stationary" shares walking's bucket — see packages/contracts/src/story.ts. */
export const LENGTH_TARGETS_WORDS: Record<"driving" | "biking" | "walking", { min: number; max: number }> = {
  driving: { min: 60, max: 100 },
  biking: { min: 120, max: 200 },
  walking: { min: 250, max: 300 },
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function checkLength(narration: string, mode: Mode): GroundingCheckResult {
  const bucket = mode === "driving" ? "driving" : mode === "biking" ? "biking" : "walking";
  const target = LENGTH_TARGETS_WORDS[bucket];
  const count = wordCount(narration);
  if (count < target.min || count > target.max) {
    return { passed: false, reason: `word count ${count} outside the ${bucket} target of ${target.min}-${target.max}` };
  }
  return { passed: true };
}

// ---------------------------------------------------------------------------
// Combined report
// ---------------------------------------------------------------------------

export interface ValidateGroundingInput {
  narration: string;
  sourceExcerpt: string;
  datePrecision: DatePrecision;
  spatialFrame: SpatialFrame;
  mode: Mode;
}

export interface GroundingReport {
  passed: boolean;
  /** One entry per failed check; empty when `passed` is true. */
  failures: string[];
}

/** Runs all six Layer 2 checks and combines them into one pass/fail report. */
export function validateGrounding(input: ValidateGroundingInput): GroundingReport {
  const results = [
    checkNumeralsAndDates(input.narration, input.sourceExcerpt),
    checkEntities(input.narration, input.sourceExcerpt),
    checkVaguenessPreserved(input.narration, input.datePrecision),
    checkSpatialLanguage(input.narration, input.spatialFrame),
    checkPhraseOverlap(input.narration, input.sourceExcerpt),
    checkLength(input.narration, input.mode),
  ];

  const failures = results.filter((r) => !r.passed).map((r) => r.reason!);
  return { passed: failures.length === 0, failures };
}
