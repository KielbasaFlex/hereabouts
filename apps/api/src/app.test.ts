import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { FetchNearbyFn } from "./feed.js";

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
};

function mockFetchNearby(impl: (opts: Parameters<FetchNearbyFn>[0]) => Promise<PlaceEvent[]>) {
  return vi.fn(impl);
}

describe("GET /health", () => {
  it("reports ok", async () => {
    const app = createApp({ fetchNearby: mockFetchNearby(async () => []) });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /feed", () => {
  it("returns nearby places for a valid request", async () => {
    const app = createApp({ fetchNearby: mockFetchNearby(async () => [SAMPLE_PLACE]) });

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
    const fetchNearby = mockFetchNearby(async () => []);
    const app = createApp({ fetchNearby });

    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 0, lon: 0 }),
    });

    expect(res.status).toBe(200);
    // Default mode is "walking" -> radius 400 + 1500 padding.
    const [{ radiusM }] = fetchNearby.mock.calls[0]!;
    expect(radiusM).toBe(400 + 1500);
  });

  it("rejects a request missing required fields with 400", async () => {
    const app = createApp({ fetchNearby: mockFetchNearby(async () => []) });

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
    const app = createApp({ fetchNearby: mockFetchNearby(async () => []) });
    const res = await app.request("/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 502 when the upstream source fails, without leaking the raw error", async () => {
    const app = createApp({
      fetchNearby: mockFetchNearby(async () => {
        throw new Error("Wikipedia API request failed: 503 Service Unavailable");
      }),
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
