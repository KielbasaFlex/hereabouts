import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent } from "@hereabouts/contracts";
import type { SpatialFrame } from "@hereabouts/core";
import { describe, expect, it, vi } from "vitest";
import { buildStory } from "./build-story.js";
import { InMemoryStoryCache } from "./cache.js";
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
  sourceExcerpt:
    "The Ybor City cigar factory opened in 1905. It became a center of Tampa's cigar-rolling industry, employing thousands of workers from Cuba, Spain, and Italy.",
  sourceUrl: "https://en.wikipedia.org/wiki/Ybor_City",
  license: "cc-by-sa-4.0",
  topics: [],
  notability: 0.5,
  externalIds: {},
  isRegional: false,
};

const REGIONAL_FRAME: SpatialFrame = { allow: "regional", distanceM: 8000, side: null };

// Genuinely grounded, non-mirroring, correct-length-for-driving (60-100
// words) narration built only from PLACE.sourceExcerpt's facts.
const GOOD_NARRATION =
  "Around this part of town, a cigar factory got its start back in 1905, right in Ybor City. " +
  "It grew into a real hub for hand-rolling cigars over the years, drawing in a workforce of " +
  "thousands who came looking for work from Cuba, Spain, and Italy. That mix of backgrounds " +
  "shaped the whole neighborhood, giving this stretch of Tampa a genuinely international flavor " +
  "that's still part of its identity today, decades on.";

const TOO_SHORT_NARRATION = "A cigar factory opened here once.";

const PASSING_JUDGE: JudgeResult = { allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false };
const FAILING_JUDGE: JudgeResult = {
  allFactsSupported: false,
  unsupportedClaim: "an invented detail",
  mirrorsSourcePhrasing: false,
};

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function makeClient(opts: {
  createResponses: unknown[]; // one entry per expected messages.create call, in order
  judgeResult?: JudgeResult | null | "throw";
}): Pick<Anthropic, "messages"> {
  const create = vi.fn();
  for (const response of opts.createResponses) create.mockResolvedValueOnce(response);

  const parse = vi.fn(async () => {
    if (opts.judgeResult === "throw") throw new Error("judge network error");
    return { parsed_output: opts.judgeResult ?? PASSING_JUDGE };
  });

  return { messages: { create, parse } } as unknown as Pick<Anthropic, "messages">;
}

describe("buildStory — cache", () => {
  it("returns a cached entry without calling the model at all", async () => {
    const cache = new InMemoryStoryCache();
    cache.set(
      { placeId: PLACE.id, lengthBucket: "driving", promptVersion: "v1" },
      { narration: "Cached narration.", citations: [], validationStatus: "validated", model: "claude-sonnet-5" },
    );
    const client = makeClient({ createResponses: [] });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.cached).toBe(true);
    expect(story.narration).toBe("Cached narration.");
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("caches a fresh result so a second call is a cache hit", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({ createResponses: [textResponse(GOOD_NARRATION)] });

    const first = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });
    expect(first.cached).toBe(false);

    const second = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });
    expect(second.cached).toBe(true);
    expect(second.narration).toBe(first.narration);
    expect(client.messages.create).toHaveBeenCalledTimes(1); // not called again for the second request
  });
});

describe("buildStory — the happy path", () => {
  it("serves the generated narration when it passes grounding and the judge", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({ createResponses: [textResponse(GOOD_NARRATION)], judgeResult: PASSING_JUDGE });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("validated");
    expect(story.narration).toBe(GOOD_NARRATION);
    expect(story.placeId).toBe(PLACE.id);
    expect(story.lengthBucket).toBe("driving");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("buildStory — resilience to a failed model call", () => {
  it("treats a thrown generation error as a failed attempt, regenerates, and can still succeed", async () => {
    const cache = new InMemoryStoryCache();
    const create = vi.fn();
    create.mockRejectedValueOnce(new Error("network error"));
    create.mockResolvedValueOnce(textResponse(GOOD_NARRATION));
    const client = { messages: { create, parse: vi.fn(async () => ({ parsed_output: PASSING_JUDGE })) } } as unknown as Pick<
      Anthropic,
      "messages"
    >;

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("validated");
    expect(story.narration).toBe(GOOD_NARRATION);
  });

  it("degrades to the template fallback, not a thrown error, when every attempt's model call fails", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({ createResponses: [] }); // no queued responses: create() rejects by default (unmocked)
    (client.messages.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("template_fallback");
    expect(story.narration).toContain(PLACE.sourceExcerpt);
  });
});

describe("buildStory — regeneration and fallback", () => {
  it("regenerates once when the first attempt fails grounding, and serves the second if it passes", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({
      createResponses: [textResponse(TOO_SHORT_NARRATION), textResponse(GOOD_NARRATION)],
      judgeResult: PASSING_JUDGE,
    });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("validated");
    expect(story.narration).toBe(GOOD_NARRATION);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("falls back to the template card when both attempts fail grounding", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({
      createResponses: [textResponse(TOO_SHORT_NARRATION), textResponse(TOO_SHORT_NARRATION)],
    });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("template_fallback");
    expect(story.narration).toContain(PLACE.sourceExcerpt); // grounded by construction
    expect(story.citations).toEqual([]);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(client.messages.parse).not.toHaveBeenCalled(); // no point judging a narration we already discarded
  });

  it("falls back to the template card when the judge flags an unsupported claim, even though Layer 2 passed", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({ createResponses: [textResponse(GOOD_NARRATION)], judgeResult: FAILING_JUDGE });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("template_fallback");
    expect(story.citations).toEqual([]);
  });

  it("does not invalidate a Layer-2-passed narration when the judge call itself fails", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({ createResponses: [textResponse(GOOD_NARRATION)], judgeResult: "throw" });

    const story = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(story.validationStatus).toBe("validated");
    expect(story.narration).toBe(GOOD_NARRATION);
  });

  it("caches the template fallback too, so a repeated failure doesn't regenerate every time", async () => {
    const cache = new InMemoryStoryCache();
    const client = makeClient({
      createResponses: [textResponse(TOO_SHORT_NARRATION), textResponse(TOO_SHORT_NARRATION)],
    });

    await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });
    const second = await buildStory({ place: PLACE, mode: "driving", spatialFrame: REGIONAL_FRAME, cache, client });

    expect(second.cached).toBe(true);
    expect(second.validationStatus).toBe("template_fallback");
    expect(client.messages.create).toHaveBeenCalledTimes(2); // only from the first call
  });
});
