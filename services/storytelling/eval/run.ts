import Anthropic from "@anthropic-ai/sdk";
import { validateGrounding } from "@hereabouts/core";
import { generateNarration } from "../src/generate.js";
import { judgeNarration } from "../src/judge.js";
import { EVAL_FIXTURES } from "./fixtures.js";

/**
 * The Milestone 3 eval hill-climb (PLAN.md §14, and the user's own
 * resolution: "add the eval hill-climb as an M3 subtask using the grounding
 * validators as grader, and test claude-haiku-4-5-20251001 for validation").
 *
 * For each fixture in `fixtures.ts`, this calls the real
 * `generateNarration` (claude-sonnet-5) against the fixture's source
 * excerpt, grades the result with the Layer 2 deterministic validators
 * (`@hereabouts/core`'s `validateGrounding` — the grader the user asked
 * for), and separately runs the Layer 3 judge (claude-haiku-4-5-20251001)
 * to see whether it agrees. The two are reported side by side rather than
 * one gating the other, specifically so a Sonnet/Haiku disagreement is
 * visible instead of silently resolved.
 *
 * Requires a real `ANTHROPIC_API_KEY` — see `README.md` in this directory
 * for why this has never been run in this environment, and exactly how to
 * run it once a key exists.
 *
 * Usage: pnpm --filter @hereabouts/storytelling exec tsx eval/run.ts
 */

interface FixtureResult {
  id: string;
  description: string;
  narration: string;
  wordCount: number;
  citationCount: number;
  layer2: { passed: boolean; failures: string[] };
  layer3: { allFactsSupported: boolean; mirrorsSourcePhrasing: boolean; unsupportedClaim: string | null } | { error: string };
}

async function main() {
  const client = new Anthropic();
  const results: FixtureResult[] = [];

  for (const fixture of EVAL_FIXTURES) {
    process.stdout.write(`Running "${fixture.id}"...\n`);

    const generated = await generateNarration({
      place: fixture.place,
      mode: fixture.mode,
      spatialFrame: fixture.spatialFrame,
      client,
    });

    const layer2 = validateGrounding({
      narration: generated.narration,
      sourceExcerpt: fixture.place.sourceExcerpt,
      datePrecision: fixture.place.datePrecision,
      spatialFrame: fixture.spatialFrame,
      mode: fixture.mode,
    });

    let layer3: FixtureResult["layer3"];
    try {
      const judged = await judgeNarration({
        narration: generated.narration,
        sourceExcerpt: fixture.place.sourceExcerpt,
        client,
      });
      layer3 = {
        allFactsSupported: judged.allFactsSupported,
        mirrorsSourcePhrasing: judged.mirrorsSourcePhrasing,
        unsupportedClaim: judged.unsupportedClaim,
      };
    } catch (err) {
      layer3 = { error: err instanceof Error ? err.message : String(err) };
    }

    results.push({
      id: fixture.id,
      description: fixture.description,
      narration: generated.narration,
      wordCount: generated.narration.trim().split(/\s+/).filter(Boolean).length,
      citationCount: generated.citations.length,
      layer2: { passed: layer2.passed, failures: layer2.failures },
      layer3,
    });
  }

  console.log("\n" + "=".repeat(80));
  for (const r of results) {
    console.log(`\n[${r.id}] ${r.description}`);
    console.log(`  words: ${r.wordCount}  citations: ${r.citationCount}`);
    console.log(`  narration: ${r.narration}`);
    console.log(`  Layer 2 (deterministic): ${r.layer2.passed ? "PASS" : "FAIL — " + r.layer2.failures.join("; ")}`);
    if ("error" in r.layer3) {
      console.log(`  Layer 3 (judge): ERROR — ${r.layer3.error}`);
    } else {
      console.log(
        `  Layer 3 (judge): allFactsSupported=${r.layer3.allFactsSupported} mirrorsSourcePhrasing=${r.layer3.mirrorsSourcePhrasing}` +
          (r.layer3.unsupportedClaim ? ` unsupportedClaim="${r.layer3.unsupportedClaim}"` : ""),
      );
    }
  }

  const layer2PassCount = results.filter((r) => r.layer2.passed).length;
  console.log("\n" + "=".repeat(80));
  console.log(`Layer 2 pass rate: ${layer2PassCount}/${results.length}`);
  console.log(
    "Compare each fixture's Layer 2 verdict against its Layer 3 verdict above — a fixture where " +
      "Layer 2 passes but the judge flags mirrorsSourcePhrasing (or vice versa) is exactly the " +
      "disagreement this eval exists to surface.",
  );
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exitCode = 1;
});
