import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it, vi } from "vitest";
import { finalizeNarration } from "./finalize.js";
import type { GeneratedNarration } from "./generate.js";
import type { JudgeResult } from "./judge.js";

const PLACE: PlaceEvent = {
  id: "wikipedia:1",
  source: "wikipedia",
  sourceId: "1",
  title: "Ybor City Cigar Factory",
  lat: 27.9506,
  lon: -82.4362,
  datePrecision: "year",
  summary: "s",
  sourceExcerpt: "The Ybor City cigar factory opened in 1905.",
  sourceUrl: "https://en.wikipedia.org/wiki/Ybor_City",
  license: "cc-by-sa-4.0",
  topics: [],
  notability: 0.5,
  externalIds: {},
  isRegional: false,
};

const GENERATED: GeneratedNarration = {
  narration: "A cigar factory got its start here in 1905.",
  citations: [{ citedText: "opened in 1905", startCharIndex: 26, endCharIndex: 41 }],
  model: "claude-sonnet-5",
};

function clientWithJudge(judgeResult: JudgeResult | "throw"): Pick<Anthropic, "messages"> {
  const parse = vi.fn(async () => {
    if (judgeResult === "throw") throw new Error("judge network error");
    return { parsed_output: judgeResult };
  });
  return { messages: { parse } } as unknown as Pick<Anthropic, "messages">;
}

describe("finalizeNarration", () => {
  it("falls back to the template when groundedGenerated is null (generation/Layer 2 gave up)", async () => {
    const client = clientWithJudge("throw"); // must not even be called
    const result = await finalizeNarration({ place: PLACE, groundedGenerated: null, client });

    expect(result.validationStatus).toBe("template_fallback");
    expect(result.citations).toEqual([]);
    expect(result.narration).toContain(PLACE.sourceExcerpt);
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("serves the generated narration when the judge passes it", async () => {
    const client = clientWithJudge({ allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false });
    const result = await finalizeNarration({ place: PLACE, groundedGenerated: GENERATED, client });

    expect(result.validationStatus).toBe("validated");
    expect(result.narration).toBe(GENERATED.narration);
    expect(result.citations).toEqual(GENERATED.citations);
  });

  it("falls back when the judge flags an unsupported claim", async () => {
    const client = clientWithJudge({ allFactsSupported: false, unsupportedClaim: "x", mirrorsSourcePhrasing: false });
    const result = await finalizeNarration({ place: PLACE, groundedGenerated: GENERATED, client });

    expect(result.validationStatus).toBe("template_fallback");
    expect(result.citations).toEqual([]);
  });

  it("falls back when the judge flags source-mirroring", async () => {
    const client = clientWithJudge({ allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: true });
    const result = await finalizeNarration({ place: PLACE, groundedGenerated: GENERATED, client });

    expect(result.validationStatus).toBe("template_fallback");
  });

  it("serves the generated narration when the judge call itself throws", async () => {
    const client = clientWithJudge("throw");
    const result = await finalizeNarration({ place: PLACE, groundedGenerated: GENERATED, client });

    expect(result.validationStatus).toBe("validated");
    expect(result.narration).toBe(GENERATED.narration);
  });
});
