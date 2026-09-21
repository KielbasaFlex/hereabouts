import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it } from "vitest";
import { buildTemplateFallback } from "./template-fallback.js";

function place(overrides: Partial<PlaceEvent> = {}): PlaceEvent {
  return {
    id: "wikipedia:1",
    source: "wikipedia",
    sourceId: "1",
    title: "Tampa Theatre",
    lat: 0,
    lon: 0,
    datePrecision: "unknown",
    summary: "s",
    sourceExcerpt: "The Tampa Theatre opened in 1926.",
    sourceUrl: "https://example.org/x",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.5,
    externalIds: {},
    isRegional: false,
    ...overrides,
  };
}

describe("buildTemplateFallback", () => {
  it("concatenates title and verbatim source excerpt", () => {
    const result = buildTemplateFallback(place());
    expect(result).toBe("Tampa Theatre. The Tampa Theatre opened in 1926.");
  });

  it("includes eraText in parentheses when present", () => {
    const result = buildTemplateFallback(place({ eraText: "1926" }));
    expect(result).toBe("Tampa Theatre (1926). The Tampa Theatre opened in 1926.");
  });

  it("is grounded by construction — the excerpt appears verbatim", () => {
    const excerpt = "A very specific, verbatim sentence from the source.";
    const result = buildTemplateFallback(place({ sourceExcerpt: excerpt }));
    expect(result).toContain(excerpt);
  });
});
