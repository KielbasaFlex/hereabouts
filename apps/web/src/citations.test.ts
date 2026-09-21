import type { Citation } from "@hereabouts/contracts";
import { describe, expect, it } from "vitest";
import { buildHighlightedSegments } from "./citations.js";

const TEXT = "The bridge opened in 1932 and spans the river.";

function citation(startCharIndex: number, endCharIndex: number): Citation {
  return { citedText: TEXT.slice(startCharIndex, endCharIndex), startCharIndex, endCharIndex };
}

/** Builds a citation from a substring's own text, so tests never hand-count character indices. */
function citationFor(substring: string): Citation {
  const startCharIndex = TEXT.indexOf(substring);
  if (startCharIndex === -1) throw new Error(`"${substring}" not found in TEXT`);
  return citation(startCharIndex, startCharIndex + substring.length);
}

describe("buildHighlightedSegments", () => {
  it("returns the whole text as one uncited segment when there are no citations", () => {
    expect(buildHighlightedSegments(TEXT, [])).toEqual([{ text: TEXT, cited: false }]);
  });

  it("splits into plain/cited/plain around a single citation", () => {
    const segments = buildHighlightedSegments(TEXT, [citationFor("bridge opened in 1932")]);
    expect(segments).toEqual([
      { text: "The ", cited: false },
      { text: "bridge opened in 1932", cited: true },
      { text: " and spans the river.", cited: false },
    ]);
  });

  it("handles a citation covering the entire text", () => {
    const segments = buildHighlightedSegments(TEXT, [citation(0, TEXT.length)]);
    expect(segments).toEqual([{ text: TEXT, cited: true }]);
  });

  it("handles multiple non-overlapping citations", () => {
    const segments = buildHighlightedSegments(TEXT, [citationFor("The"), citationFor("the river")]);
    expect(segments.filter((s) => s.cited).map((s) => s.text)).toEqual(["The", "the river"]);
  });

  it("merges overlapping citations instead of double-rendering them", () => {
    const segments = buildHighlightedSegments(TEXT, [citationFor("bridge open"), citationFor("opened in 1932")]);
    expect(segments).toEqual([
      { text: "The ", cited: false },
      { text: "bridge opened in 1932", cited: true },
      { text: " and spans the river.", cited: false },
    ]);
  });

  it("clamps an out-of-range citation to the text bounds rather than throwing", () => {
    const segments = buildHighlightedSegments(TEXT, [{ citedText: "junk", startCharIndex: 40, endCharIndex: 9999 }]);
    expect(segments[segments.length - 1]).toEqual({ text: TEXT.slice(40), cited: true });
  });

  it("drops a zero-width or inverted range", () => {
    expect(buildHighlightedSegments(TEXT, [{ citedText: "", startCharIndex: 5, endCharIndex: 5 }])).toEqual([
      { text: TEXT, cited: false },
    ]);
    expect(buildHighlightedSegments(TEXT, [{ citedText: "", startCharIndex: 10, endCharIndex: 2 }])).toEqual([
      { text: TEXT, cited: false },
    ]);
  });
});
