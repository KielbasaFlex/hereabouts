import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceEvent, RoutePack, Story } from "@hereabouts/contracts";
import { InMemoryStoryCache, type StoryCache } from "@hereabouts/storytelling";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { FeedDependencies, FetchSourceFn } from "./feed.js";
import type { RoutePackDependencies } from "./route-pack.js";
import type { StoryDependencies } from "./story.js";

const SAMPLE_PLACE: PlaceEvent = {
  id: "wikipedia:1",
  source: "wikipedia",
  sourceId: "1",
  title: "Tampa Theatre",
  lat: 27.9478,
  lon: -82.459,
  datePrecision: "unknown",
  summary: "A historic movie palace.",
  sourceExcerpt: "A historic movie palace.",
  sourceUrl: "https://en.wikipedia.org/wiki/Tampa_Theatre",
  license: "cc-by-sa-4.0",
  topics: [],
  notability: 0.5,
  externalIds: {},
  isRegional: false,
};

function noopFeedDeps(overrides: Partial<FeedDependencies> = {}): FeedDependencies {
  return {
    fetchWikipedia: vi.fn(async () => []),
    fetchWikidata: vi.fn(async () => []),
    fetchOverpass: vi.fn(async () => []),
    fetchNrhp: vi.fn(() => []),
    fetchNearestSettlement: vi.fn(async () => null),
    fetchWikipediaArticle: vi.fn(async () => null),
    ...overrides,
  };
}

// Grounded against SAMPLE_PLACE's (very short) source excerpt, and sized to
// pass the driving-mode word-count check (60-100 words) on the first try —
// a too-short fixture would trigger buildStory's regenerate-once path,
// which is a real behavior but not what these route-wiring tests are about.
const VALID_DRIVING_NARRATION =
  "Right around here sits a historic movie palace, the kind of building that's been part of " +
  "this block for longer than most people passing by probably realize. It's simply that: a " +
  "historic movie palace, nothing more elaborate noted about it, though that alone says " +
  "something about the kind of entertainment this corner of town once offered. Worth a glance " +
  "if you're passing, even just to picture what a night out here might once have looked like.";

function fakeAnthropicClient(textResponse: string): Pick<Anthropic, "messages"> {
  return {
    messages: {
      create: vi.fn(async () => ({ content: [{ type: "text", text: textResponse }] })),
      parse: vi.fn(async () => ({
        parsed_output: { allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false },
      })),
    },
  } as unknown as Pick<Anthropic, "messages">;
}

function noopStoryDeps(overrides: Partial<StoryDependencies> = {}): StoryDependencies {
  return {
    client: fakeAnthropicClient(VALID_DRIVING_NARRATION),
    cache: new InMemoryStoryCache(),
    ...overrides,
  };
}

/** A fake client with working Batch API methods, for route-pack tests — every submitted request "succeeds" with `narration`. */
function fakeBatchAnthropicClient(narration: string): Pick<Anthropic, "messages"> {
  let submittedIds: string[] = [];
  const batchesCreate = vi.fn(async (params: { requests: { custom_id: string }[] }) => {
    submittedIds = params.requests.map((r) => r.custom_id);
    return { id: "batch_test", processing_status: "in_progress" };
  });
  const retrieve = vi.fn(async () => ({ processing_status: "ended" }));
  const results = vi.fn(async () => ({
    [Symbol.asyncIterator]: async function* () {
      for (const customId of submittedIds) {
        yield { custom_id: customId, result: { type: "succeeded", message: { content: [{ type: "text", text: narration }] } } };
      }
    },
  }));
  return {
    messages: {
      create: vi.fn(async () => ({ content: [{ type: "text", text: narration }] })),
      parse: vi.fn(async () => ({
        parsed_output: { allFactsSupported: true, unsupportedClaim: null, mirrorsSourcePhrasing: false },
      })),
      batches: { create: batchesCreate, retrieve, results },
    },
  } as unknown as Pick<Anthropic, "messages">;
}

function noopRoutePackDeps(
  overrides: Partial<Omit<RoutePackDependencies, "feed">> & { feed?: Partial<FeedDependencies> } = {},
): RoutePackDependencies {
  return {
    fetchRoute: vi.fn(async () => ({
      points: [{ lat: 27.9506, lon: -82.4572 }, { lat: 27.9516, lon: -82.4562 }],
      distanceM: 130,
      durationS: 25,
    })),
    loadTrack: vi.fn(async () => [{ lat: 27.9506, lon: -82.4572 }, { lat: 27.9516, lon: -82.4562 }]),
    client: fakeBatchAnthropicClient(VALID_DRIVING_NARRATION),
    cache: new InMemoryStoryCache(),
    ...overrides,
    feed: noopFeedDeps(overrides.feed),
  };
}

function testApp(
  overrides: {
    feed?: Partial<FeedDependencies>;
    story?: Partial<StoryDependencies>;
    routePack?: Partial<Omit<RoutePackDependencies, "feed">> & { feed?: Partial<FeedDependencies> };
  } = {},
) {
  return createApp({
    feed: noopFeedDeps(overrides.feed),
    story: noopStoryDeps(overrides.story),
    routePack: noopRoutePackDeps(overrides.routePack),
  });
}

describe("GET /health", () => {
  it("reports ok", async () => {
    const app = testApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /feed", () => {
  it("returns nearby places for a valid request", async () => {
    const app = testApp({ feed: { fetchWikipedia: vi.fn(async () => [SAMPLE_PLACE]) } });

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 27.9478, lon: -82.459, mode: "walking" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { places: PlaceEvent[] };
    expect(body.places).toHaveLength(1);
    expect(body.places[0]?.title).toBe("Tampa Theatre");
  });

  it("applies FeedRequest defaults when optional fields are omitted", async () => {
    const fetchWikipedia = vi.fn<FetchSourceFn>(async () => []);
    const app = testApp({ feed: { fetchWikipedia } });

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 0, lon: 0 }),
    });

    expect(res.status).toBe(200);
    // Default mode is "walking" -> radius 400 + 1500 padding.
    const [{ radiusM }] = fetchWikipedia.mock.calls[0]!;
    expect(radiusM).toBe(400 + 1500);
  });

  it("rejects a request missing required fields with 400", async () => {
    const app = testApp();

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lon: -82.459 }), // missing lat
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects a non-JSON body with 400 rather than throwing", async () => {
    const app = testApp();
    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with an empty feed, not 502, when every live source fails", async () => {
    // Milestone 2's resilience design: a wobble in any one source (or all
    // of them) never fails the whole request — that's exactly the
    // "degrade silently" behavior PLAN.md §16.3 asks for.
    const app = testApp({
      feed: {
        fetchWikipedia: vi.fn(async () => {
          throw new Error("network error");
        }),
        fetchWikidata: vi.fn(async () => {
          throw new Error("WDQS timeout");
        }),
        fetchOverpass: vi.fn(async () => {
          throw new Error("Overpass 504");
        }),
      },
    });

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 0, lon: 0 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { places: PlaceEvent[] };
    expect(body.places).toEqual([]);
  });

  it("returns 502 on a genuinely unexpected internal error", async () => {
    const app = testApp({
      feed: {
        // The NRHP call is synchronous and expected never to fail (it's a
        // local dataset, not a network call) — buildFeed doesn't wrap it in
        // a try/catch, so a bug there is exactly the "genuinely unexpected"
        // case the 502 path exists for.
        fetchNrhp: vi.fn(() => {
          throw new Error("dataset corrupted");
        }),
      },
    });

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 0, lon: 0 }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("upstream_error");
  });
});

describe("POST /story", () => {
  it("returns a generated story for a valid request", async () => {
    const app = testApp();

    const res = await app.request("/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: SAMPLE_PLACE, mode: "driving", lat: 27.9478, lon: -82.459 }),
    });

    expect(res.status).toBe(200);
    const story = (await res.json()) as Story;
    expect(story.placeId).toBe(SAMPLE_PLACE.id);
    expect(story.lengthBucket).toBe("driving");
    expect(story.validationStatus).toBe("validated"); // confirms the fixture passes grounding on the first attempt
    expect(typeof story.narration).toBe("string");
  });

  it("rejects a request missing the place", async () => {
    const app = testApp();
    const res = await app.request("/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "walking", lat: 0, lon: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("degrades to the template fallback (200), not a 502, when the model call itself fails", async () => {
    const failingClient: Pick<Anthropic, "messages"> = {
      messages: {
        create: vi.fn(async () => {
          throw new Error("network error");
        }),
        parse: vi.fn(),
      },
    } as unknown as Pick<Anthropic, "messages">;

    const app = testApp({ story: { client: failingClient } });

    const res = await app.request("/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: SAMPLE_PLACE, mode: "driving", lat: 27.9478, lon: -82.459 }),
    });

    // A thrown generation error is caught inside buildStory and treated
    // like a failed grounding check (services/storytelling/src/build-story.ts)
    // — it degrades to the template card, it doesn't fail the request.
    expect(res.status).toBe(200);
    const story = (await res.json()) as Story;
    expect(story.validationStatus).toBe("template_fallback");
  });

  it("returns 502 on a genuinely unexpected internal error", async () => {
    const brokenCache: StoryCache = {
      get: () => {
        throw new Error("cache corrupted");
      },
      set: vi.fn(),
    };

    const app = testApp({ story: { cache: brokenCache } });

    const res = await app.request("/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: SAMPLE_PLACE, mode: "driving", lat: 27.9478, lon: -82.459 }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("generation_error");
  });

  it("shares the cache across requests for the same place/mode", async () => {
    const client = fakeAnthropicClient(VALID_DRIVING_NARRATION);
    const cache = new InMemoryStoryCache();
    const app = testApp({ story: { client, cache } });

    const requestBody = JSON.stringify({ place: SAMPLE_PLACE, mode: "driving", lat: 27.9478, lon: -82.459 });
    await app.request("/story", { method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody });
    const second = await app.request("/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const story = (await second.json()) as Story;
    expect(story.cached).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("POST /route-pack", () => {
  it("builds a pack from a named sample track — no live routing call needed", async () => {
    const app = testApp({ routePack: { feed: { fetchWikipedia: vi.fn(async () => [SAMPLE_PLACE]) } } });

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "driving", trackId: "downtown-walk" }),
    });

    expect(res.status).toBe(200);
    const pack = (await res.json()) as RoutePack;
    expect(pack.places).toHaveLength(1);
    expect(pack.places[0]!.id).toBe(SAMPLE_PLACE.id);
    expect(pack.stories).toHaveLength(1);
    expect(pack.stories[0]!.placeId).toBe(SAMPLE_PLACE.id);
    expect(pack.tiles.length).toBeGreaterThan(0);
    expect(pack.attribution).toContain("Wikipedia, CC BY-SA 4.0");
    expect(pack.route.points.length).toBeGreaterThan(0);
  });

  it("builds a pack from an origin/destination pair via the routing adapter", async () => {
    const fetchRoute = vi.fn(async () => ({
      points: [{ lat: 27.9506, lon: -82.4572 }, { lat: 27.9516, lon: -82.4562 }],
      distanceM: 130,
      durationS: 25,
    }));
    const app = testApp({ routePack: { fetchRoute } });

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "driving",
        origin: { lat: 27.9506, lon: -82.4572 },
        destination: { lat: 27.9516, lon: -82.4562 },
      }),
    });

    expect(res.status).toBe(200);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
  });

  it("returns an empty pack (not an error) when nothing is found along the route", async () => {
    const app = testApp();

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "driving", trackId: "downtown-walk" }),
    });

    expect(res.status).toBe(200);
    const pack = (await res.json()) as RoutePack;
    expect(pack.places).toEqual([]);
    expect(pack.stories).toEqual([]);
  });

  it("returns 400 for a request with neither trackId nor origin/destination", async () => {
    const app = testApp();

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "driving" }),
    });

    expect(res.status).toBe(400);
  });

  it("degrades to template-fallback stories (200), not a 502, when the Batch API itself is unreachable", async () => {
    // Mirrors /story's own resilience test: a thrown batch-submission error
    // (e.g. this environment's missing ANTHROPIC_API_KEY rejecting the
    // request client-side, same as Milestone 3's /story finding) is caught
    // inside generateStoriesViaBatch and treated as every place's batch
    // request having failed — it degrades the pack, it doesn't fail it.
    const brokenClient = {
      messages: {
        batches: {
          create: vi.fn(async () => {
            throw new Error("batches API is down");
          }),
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const app = testApp({
      routePack: { feed: { fetchWikipedia: vi.fn(async () => [SAMPLE_PLACE]) }, client: brokenClient },
    });

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "driving", trackId: "downtown-walk" }),
    });

    expect(res.status).toBe(200);
    const pack = (await res.json()) as RoutePack;
    expect(pack.stories).toHaveLength(1);
    expect(pack.stories[0]!.validationStatus).toBe("template_fallback");
    expect(pack.stories[0]!.narration).toContain(SAMPLE_PLACE.sourceExcerpt);
  });

  it("returns 502 on a genuinely unexpected internal error", async () => {
    const brokenCache: StoryCache = {
      get: () => undefined,
      set: () => {
        throw new Error("cache corrupted");
      },
    };
    const app = testApp({
      routePack: { feed: { fetchWikipedia: vi.fn(async () => [SAMPLE_PLACE]) }, cache: brokenCache },
    });

    const res = await app.request("/route-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "driving", trackId: "downtown-walk" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("route_pack_error");
  });
});
