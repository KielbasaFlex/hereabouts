import { describe, expect, it } from "vitest";
import { classifyTopics, TOPIC_IDS, TOPIC_LABELS } from "./index.js";

describe("classifyTopics", () => {
  it("matches a single obvious keyword", () => {
    expect(classifyTopics("The old lighthouse has guided ships since 1890.")).toEqual(["maritime"]);
  });

  it("matches multiple topics when multiple keywords are present", () => {
    const topics = classifyTopics("The courthouse was built near the old railroad depot.");
    expect(topics).toContain("government-civic");
    expect(topics).toContain("transportation");
  });

  it("returns an empty array when nothing matches", () => {
    expect(classifyTopics("A quiet grassy field with no notable features.")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(classifyTopics("MEMORIAL erected in 1955.")).toEqual(["commemorative"]);
  });

  it("matches whole words only, not substrings inside other words", () => {
    // "courthouse" contains "house" but is a distinct government building,
    // not a residence — the residential keyword must not fire on it.
    expect(classifyTopics("A stately courthouse downtown.")).toEqual(["government-civic"]);
  });

  it("matches a standalone occurrence of a keyword that is also a substring elsewhere", () => {
    expect(classifyTopics("The old house on the hill.")).toEqual(["residential"]);
  });

  it("every topic id has a display label", () => {
    for (const id of TOPIC_IDS) {
      expect(TOPIC_LABELS[id]).toBeTruthy();
    }
  });
});
