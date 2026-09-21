import { describe, expect, it } from "vitest";
import { Story, StoryRequest } from "./index.js";

describe("Story", () => {
  it("accepts a well-formed validated story", () => {
    const result = Story.safeParse({
      placeId: "wikipedia:1",
      lengthBucket: "walking",
      narration: "Some grounded narration.",
      citations: [{ citedText: "Some grounded text.", startCharIndex: 0, endCharIndex: 20 }],
      validationStatus: "validated",
      model: "claude-sonnet-5",
      promptVersion: "v1",
      cached: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a template-fallback story with no citations", () => {
    const result = Story.safeParse({
      placeId: "wikipedia:1",
      lengthBucket: "driving",
      narration: "Fallback text.",
      citations: [],
      validationStatus: "template_fallback",
      model: "claude-sonnet-5",
      promptVersion: "v1",
      cached: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown length bucket", () => {
    const result = Story.safeParse({
      placeId: "x",
      lengthBucket: "stationary",
      narration: "x",
      citations: [],
      validationStatus: "validated",
      model: "x",
      promptVersion: "v1",
      cached: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("StoryRequest", () => {
  it("defaults headingDeg", () => {
    const result = StoryRequest.parse({
      place: {
        id: "wikipedia:1",
        source: "wikipedia",
        sourceId: "1",
        title: "X",
        lat: 0,
        lon: 0,
        datePrecision: "unknown",
        summary: "s",
        sourceExcerpt: "e",
        sourceUrl: "https://example.org/x",
        license: "cc-by-sa-4.0",
      },
      mode: "walking",
      lat: 0,
      lon: 0,
    });
    expect(result.headingDeg).toBe(0);
  });
});
