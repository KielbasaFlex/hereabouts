import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent } from "@hereabouts/contracts";
import type { SpatialFrame } from "@hereabouts/core";
import { describe, expect, it, vi } from "vitest";
import { generateNarration } from "./generate.js";

const PLACE: PlaceEvent = {
  id: "wikipedia:1",
  source: "wikipedia",
  sourceId: "1",
  title: "Tampa Theatre",
  lat: 27.9478,
  lon: -82.459,
  datePrecision: "year",
  summary: "A historic movie palace.",
  sourceExcerpt: "The Tampa Theatre opened in 1926. It is a historic movie palace.",
  sourceUrl: "https://en.wikipedia.org/wiki/Tampa_Theatre",
  license: "cc-by-sa-4.0",
  topics: [],
  notability: 0.5,
  externalIds: {},
  isRegional: false,
};

const FRAME: SpatialFrame = { allow: "proximal", distanceM: 200, side: null };

function fakeClient(content: unknown[]): Pick<Anthropic, "messages"> {
  return {
    messages: {
      create: vi.fn(async () => ({ content })),
    },
  } as unknown as Pick<Anthropic, "messages">;
}

describe("generateNarration", () => {
  it("concatenates text blocks and collects char_location citations", async () => {
    const client = fakeClient([
      { type: "text", text: "Right here, " },
      {
        type: "text",
        text: "the Tampa Theatre opened in 1926",
        citations: [
          {
            type: "char_location",
            cited_text: "The Tampa Theatre opened in 1926.",
            document_index: 0,
            document_title: "Tampa Theatre",
            start_char_index: 0,
            end_char_index: 34,
          },
        ],
      },
      { type: "text", text: ", still standing today." },
    ]);

    const result = await generateNarration({ place: PLACE, mode: "walking", spatialFrame: FRAME, client });

    expect(result.narration).toBe("Right here, the Tampa Theatre opened in 1926, still standing today.");
    expect(result.citations).toEqual([
      { citedText: "The Tampa Theatre opened in 1926.", startCharIndex: 0, endCharIndex: 34 },
    ]);
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("skips thinking blocks when assembling the narration", async () => {
    const client = fakeClient([
      { type: "thinking", thinking: "Let me plan this out..." },
      { type: "text", text: "The finished narration." },
    ]);

    const result = await generateNarration({ place: PLACE, mode: "walking", spatialFrame: FRAME, client });
    expect(result.narration).toBe("The finished narration.");
  });

  it("handles a response with no citations at all", async () => {
    const client = fakeClient([{ type: "text", text: "Plain narration, no citations returned." }]);
    const result = await generateNarration({ place: PLACE, mode: "walking", spatialFrame: FRAME, client });
    expect(result.citations).toEqual([]);
  });

  it("sends the source excerpt as a citations-enabled plain-text document", async () => {
    const client = fakeClient([{ type: "text", text: "x" }]);
    await generateNarration({ place: PLACE, mode: "driving", spatialFrame: FRAME, client });

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const userContent = call.messages[0].content;
    const documentBlock = userContent.find((b: { type: string }) => b.type === "document");

    expect(documentBlock.source).toEqual({
      type: "text",
      media_type: "text/plain",
      data: PLACE.sourceExcerpt,
    });
    expect(documentBlock.citations).toEqual({ enabled: true });
  });

  it("uses low effort and the adaptive-thinking-default model, with no output_config.format (incompatible with citations)", async () => {
    const client = fakeClient([{ type: "text", text: "x" }]);
    await generateNarration({ place: PLACE, mode: "driving", spatialFrame: FRAME, client });

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.model).toBe("claude-sonnet-5");
    expect(call.output_config).toEqual({ effort: "low" });
  });
});
