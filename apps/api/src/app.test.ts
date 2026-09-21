import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { FeedDependencies, FetchSourceFn } from "./feed.js";

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
};

function noopDeps(overrides: Partial<FeedDependencies> = {}): FeedDependencies {
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

describe("GET /health", () => {
  it("reports ok", async () => {
    const app = createApp(noopDeps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /feed", () => {
  it("returns nearby places for a valid request", async () => {
    const app = createApp(noopDeps({ fetchWikipedia: vi.fn(async () => [SAMPLE_PLACE]) }));

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
    const app = createApp(noopDeps({ fetchWikipedia }));

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
    const app = createApp(noopDeps());

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
    const app = createApp(noopDeps());
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
    const app = createApp(
      noopDeps({
        fetchWikipedia: vi.fn(async () => {
          throw new Error("network error");
        }),
        fetchWikidata: vi.fn(async () => {
          throw new Error("WDQS timeout");
        }),
        fetchOverpass: vi.fn(async () => {
          throw new Error("Overpass 504");
        }),
      }),
    );

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
    const app = createApp(
      noopDeps({
        // The NRHP call is synchronous and expected never to fail (it's a
        // local dataset, not a network call) — buildFeed doesn't wrap it in
        // a try/catch, so a bug there is exactly the "genuinely unexpected"
        // case the 502 path exists for.
        fetchNrhp: vi.fn(() => {
          throw new Error("dataset corrupted");
        }),
      }),
    );

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
