import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { judgeNarration, type JudgeResult } from "./judge.js";

function fakeClient(parsedOutput: JudgeResult | null): Pick<Anthropic, "messages"> {
  return {
    messages: {
      parse: vi.fn(async () => ({ parsed_output: parsedOutput })),
    },
  } as unknown as Pick<Anthropic, "messages">;
}

describe("judgeNarration", () => {
  it("returns the parsed structured output", async () => {
    const expected: JudgeResult = {
      allFactsSupported: true,
      unsupportedClaim: null,
      mirrorsSourcePhrasing: false,
    };
    const client = fakeClient(expected);

    const result = await judgeNarration({
      narration: "A grounded retelling.",
      sourceExcerpt: "The source text.",
      client,
    });

    expect(result).toEqual(expected);
  });

  it("flags an unsupported claim", async () => {
    const client = fakeClient({
      allFactsSupported: false,
      unsupportedClaim: "It was designed by a famous architect.",
      mirrorsSourcePhrasing: false,
    });

    const result = await judgeNarration({ narration: "x", sourceExcerpt: "y", client });
    expect(result.allFactsSupported).toBe(false);
    expect(result.unsupportedClaim).toContain("architect");
  });

  it("throws a descriptive error when structured output parsing failed", async () => {
    const client = fakeClient(null);
    await expect(judgeNarration({ narration: "x", sourceExcerpt: "y", client })).rejects.toThrow(
      /parsed_output/,
    );
  });

  it("sends the correct model and both source/narration text", async () => {
    const client = fakeClient({ allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false });
    await judgeNarration({ narration: "MY NARRATION", sourceExcerpt: "MY SOURCE", client });

    const call = (client.messages.parse as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.model).toBe("claude-haiku-4-5-20251001");
    expect(call.messages[0].content).toContain("MY NARRATION");
    expect(call.messages[0].content).toContain("MY SOURCE");
  });
});
