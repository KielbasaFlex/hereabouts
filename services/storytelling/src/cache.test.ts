import { describe, expect, it } from "vitest";
import { InMemoryStoryCache, type StoryCacheEntry, type StoryCacheKey } from "./cache.js";

const ENTRY: StoryCacheEntry = {
  narration: "A grounded narration.",
  citations: [],
  validationStatus: "validated",
  model: "claude-sonnet-5",
};

const KEY: StoryCacheKey = { placeId: "wikipedia:1", lengthBucket: "walking", promptVersion: "v1" };

describe("InMemoryStoryCache", () => {
  it("returns undefined for a key that hasn't been set", () => {
    const cache = new InMemoryStoryCache();
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("returns what was set for the same key", () => {
    const cache = new InMemoryStoryCache();
    cache.set(KEY, ENTRY);
    expect(cache.get(KEY)).toEqual(ENTRY);
  });

  it("treats a different length bucket as a different cache entry", () => {
    const cache = new InMemoryStoryCache();
    cache.set(KEY, ENTRY);
    expect(cache.get({ ...KEY, lengthBucket: "driving" })).toBeUndefined();
  });

  it("treats a different prompt version as a different cache entry", () => {
    const cache = new InMemoryStoryCache();
    cache.set(KEY, ENTRY);
    expect(cache.get({ ...KEY, promptVersion: "v2" })).toBeUndefined();
  });

  it("treats a different place id as a different cache entry", () => {
    const cache = new InMemoryStoryCache();
    cache.set(KEY, ENTRY);
    expect(cache.get({ ...KEY, placeId: "wikipedia:2" })).toBeUndefined();
  });

  it("counts distinct keys via size", () => {
    const cache = new InMemoryStoryCache();
    cache.set(KEY, ENTRY);
    cache.set({ ...KEY, lengthBucket: "driving" }, ENTRY);
    cache.set(KEY, ENTRY); // overwrite, not a new entry
    expect(cache.size).toBe(2);
  });
});
