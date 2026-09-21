import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent } from "@hereabouts/contracts";
import type { SpatialFrame } from "@hereabouts/core";
import { describe, expect, it, vi } from "vitest";
import { generateStoriesViaBatch, pollBatchUntilDone, submitBatch } from "./batch.js";
import { InMemoryStoryCache } from "./cache.js";

const REGIONAL_FRAME: SpatialFrame = { allow: "regional", distanceM: 8000, side: null };

function place(id: string, title: string, sourceExcerpt: string): PlaceEvent {
  return {
    id,
    source: "wikipedia",
    sourceId: id,
    title,
    lat: 27.95,
    lon: -82.46,
    datePrecision: "year",
    summary: sourceExcerpt,
    sourceExcerpt,
    sourceUrl: "https://example.org",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.5,
    externalIds: {},
    isRegional: false,
  };
}

// ~75 words, grounded against its own tiny excerpt, sized to pass driving's 60-100 word target.
const GOOD_NARRATION_A =
  "Around this part of town, a cigar factory got its start back in 1905, right here in the district. " +
  "It grew into a real hub for hand-rolling cigars over the years, drawing in a workforce of " +
  "thousands who came looking for work from Cuba, Spain, and Italy. That mix of backgrounds " +
  "shaped the whole neighborhood, giving this stretch of town a genuinely international flavor " +
  "that's still part of its identity today, decades on, long after the factory itself closed.";

const GOOD_NARRATION_B =
  "Just up the road, a grain exchange building went up in 1911, done up in a grand Beaux-Arts style " +
  "with a domed rotunda where traders once haggled over commodity prices on the floor below. " +
  "The exchange itself shut down in 1958, and these days the building quietly does duty as " +
  "municipal offices instead — a much calmer second act for a place that used to be full of shouting.";

function textResult(customId: string, text: string) {
  return { custom_id: customId, result: { type: "succeeded", message: { content: [{ type: "text", text }] } } };
}

interface CapturedBatchCreateParams {
  requests: { custom_id: string; params: { model: string } }[];
}

describe("submitBatch", () => {
  it("submits one request per input, keyed by custom_id: place.id", async () => {
    const create = vi.fn(async (_params: CapturedBatchCreateParams) => ({
      id: "batch_123",
      processing_status: "in_progress",
    }));
    const client = { messages: { batches: { create } } } as unknown as Pick<Anthropic, "messages">;

    const batchId = await submitBatch({
      inputs: [
        { place: place("a", "A", "Excerpt A."), mode: "driving", spatialFrame: REGIONAL_FRAME },
        { place: place("b", "B", "Excerpt B."), mode: "walking", spatialFrame: REGIONAL_FRAME },
      ],
      client,
    });

    expect(batchId).toBe("batch_123");
    expect(create).toHaveBeenCalledTimes(1);
    const requests = create.mock.calls[0]![0].requests;
    expect(requests.map((r) => r.custom_id)).toEqual(["a", "b"]);
    expect(requests[0]!.params.model).toBe("claude-sonnet-5");
  });
});

describe("pollBatchUntilDone", () => {
  it("polls until processing_status is ended, using the injected sleep (no real timers)", async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({ processing_status: "in_progress" })
      .mockResolvedValueOnce({ processing_status: "in_progress" })
      .mockResolvedValueOnce({ processing_status: "ended" });
    const client = { messages: { batches: { retrieve } } } as unknown as Pick<Anthropic, "messages">;
    const sleep = vi.fn(async () => {});

    const batch = await pollBatchUntilDone({ batchId: "batch_123", client, sleep, pollIntervalMs: 1 });

    expect(batch.processing_status).toBe("ended");
    expect(retrieve).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("throws once maxAttempts is exhausted without the batch ending", async () => {
    const retrieve = vi.fn().mockResolvedValue({ processing_status: "in_progress" });
    const client = { messages: { batches: { retrieve } } } as unknown as Pick<Anthropic, "messages">;

    await expect(
      pollBatchUntilDone({ batchId: "batch_123", client, sleep: vi.fn(async () => {}), maxAttempts: 3 }),
    ).rejects.toThrow(/did not finish/);
    expect(retrieve).toHaveBeenCalledTimes(3);
  });
});

function fakeBatchClient(results: unknown[]): Pick<Anthropic, "messages"> {
  return {
    messages: {
      batches: {
        create: vi.fn(async () => ({ id: "batch_123", processing_status: "in_progress" })),
        retrieve: vi.fn(async () => ({ processing_status: "ended" })),
        results: vi.fn(async () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const r of results) yield r;
          },
        })),
      },
      parse: vi.fn(async () => ({
        parsed_output: { allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false },
      })),
    },
  } as unknown as Pick<Anthropic, "messages">;
}

describe("generateStoriesViaBatch", () => {
  it("returns an empty array without submitting anything for zero inputs", async () => {
    const client = fakeBatchClient([]);
    const stories = await generateStoriesViaBatch({ inputs: [], client, cache: new InMemoryStoryCache() });
    expect(stories).toEqual([]);
    const batches = client.messages.batches as unknown as { create: ReturnType<typeof vi.fn> };
    expect(batches.create).not.toHaveBeenCalled();
  });

  it("produces a validated story for each place that passes grounding and the judge", async () => {
    const placeA = place("a", "Cigar Factory", "The cigar factory opened in 1905. It employed thousands of workers from Cuba, Spain, and Italy.");
    const placeB = place("b", "Grain Exchange", "The grain exchange building was completed in 1911. It was designed in the Beaux-Arts style. It stopped operating in 1958.");
    const client = fakeBatchClient([textResult("a", GOOD_NARRATION_A), textResult("b", GOOD_NARRATION_B)]);
    const cache = new InMemoryStoryCache();

    const stories = await generateStoriesViaBatch({
      inputs: [
        { place: placeA, mode: "driving", spatialFrame: REGIONAL_FRAME },
        { place: placeB, mode: "driving", spatialFrame: REGIONAL_FRAME },
      ],
      client,
      cache,
    });

    expect(stories).toHaveLength(2);
    expect(stories.map((s) => s.placeId)).toEqual(["a", "b"]); // preserves input order
    expect(stories[0]!.validationStatus).toBe("validated");
    expect(stories[1]!.validationStatus).toBe("validated");
    expect(cache.size).toBe(2); // populated the shared cache for both places
  });

  it("falls back to the template for every place when the batch submission itself throws", async () => {
    const placeA = place("a", "Cigar Factory", "The cigar factory opened in 1905.");
    const brokenClient = {
      messages: {
        batches: {
          create: vi.fn(async () => {
            throw new Error("batches API is down");
          }),
        },
        parse: vi.fn(async () => ({
          parsed_output: { allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false },
        })),
      },
    } as unknown as Pick<Anthropic, "messages">;

    const stories = await generateStoriesViaBatch({
      inputs: [{ place: placeA, mode: "driving", spatialFrame: REGIONAL_FRAME }],
      client: brokenClient,
      cache: new InMemoryStoryCache(),
    });

    expect(stories).toHaveLength(1);
    expect(stories[0]!.validationStatus).toBe("template_fallback");
    expect(stories[0]!.narration).toContain(placeA.sourceExcerpt);
  });

  it("falls back to the template for a place whose batch request errored", async () => {
    const placeA = place("a", "Cigar Factory", "The cigar factory opened in 1905.");
    const client = fakeBatchClient([
      { custom_id: "a", result: { type: "errored", error: { type: "invalid_request", message: "bad" } } },
    ]);

    const stories = await generateStoriesViaBatch({
      inputs: [{ place: placeA, mode: "driving", spatialFrame: REGIONAL_FRAME }],
      client,
      cache: new InMemoryStoryCache(),
    });

    expect(stories[0]!.validationStatus).toBe("template_fallback");
    expect(stories[0]!.narration).toContain(placeA.sourceExcerpt);
  });

  it("falls back to the template for a place whose narration fails Layer 2 grounding", async () => {
    const placeA = place("a", "Cigar Factory", "The cigar factory opened in 1905.");
    // Way too short for driving's 60-100 word target, and mismatched to the excerpt besides.
    const client = fakeBatchClient([textResult("a", "A short one.")]);

    const stories = await generateStoriesViaBatch({
      inputs: [{ place: placeA, mode: "driving", spatialFrame: REGIONAL_FRAME }],
      client,
      cache: new InMemoryStoryCache(),
    });

    expect(stories[0]!.validationStatus).toBe("template_fallback");
  });

  it("ignores a result whose custom_id doesn't match any submitted input", async () => {
    const placeA = place("a", "Cigar Factory", "The cigar factory opened in 1905. It employed thousands of workers from Cuba, Spain, and Italy.");
    const client = fakeBatchClient([textResult("a", GOOD_NARRATION_A), textResult("ghost", "stray result")]);

    const stories = await generateStoriesViaBatch({
      inputs: [{ place: placeA, mode: "driving", spatialFrame: REGIONAL_FRAME }],
      client,
      cache: new InMemoryStoryCache(),
    });

    expect(stories).toHaveLength(1);
    expect(stories[0]!.placeId).toBe("a");
  });
});
