import { haversine } from "@hereabouts/core";
import type { FeedRequest, PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildFeed, type FetchNearbyFn } from "./feed.js";

const TRUE_POSITION = { lat: 27.9506, lon: -82.4572 };

/** Approximate (flat-earth) point due east of TRUE_POSITION at `distanceM`. Test-only. */
function pointAtApproxDistanceEast(distanceM: number) {
  const metersPerDegLon = 111_320 * Math.cos((TRUE_POSITION.lat * Math.PI) / 180);
  return { lat: TRUE_POSITION.lat, lon: TRUE_POSITION.lon + distanceM / metersPerDegLon };
}

function place(id: string, approxDistanceM: number): PlaceEvent {
  const { lat, lon } = pointAtApproxDistanceEast(approxDistanceM);
  return {
    id,
    source: "wikipedia",
    sourceId: id,
    title: id,
    lat,
    lon,
    datePrecision: "unknown",
    summary: "summary",
    sourceExcerpt: "excerpt",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
    license: "cc-by-sa-4.0",
    topics: [],
  };
}

function baseRequest(overrides: Partial<FeedRequest> = {}): FeedRequest {
  return {
    lat: TRUE_POSITION.lat,
    lon: TRUE_POSITION.lon,
    headingDeg: 0,
    speedMps: 0,
    mode: "walking",
    heardIds: [],
    ...overrides,
  };
}

function mockFetchNearby(impl: (opts: Parameters<FetchNearbyFn>[0]) => Promise<PlaceEvent[]>) {
  return vi.fn(impl);
}

describe("buildFeed", () => {
  it("queries the upstream source at a privacy-rounded centroid, padded for the mode radius", async () => {
    const fetchNearby = mockFetchNearby(async () => []);
    await buildFeed(baseRequest({ mode: "driving" }), { fetchNearby });

    expect(fetchNearby).toHaveBeenCalledTimes(1);
    const [{ center, radiusM }] = fetchNearby.mock.calls[0]!;
    expect(radiusM).toBe(5000 + 1500); // driving mode radius + cell padding

    // The query center is a privacy-rounded H3 cell centroid: close to the
    // true position, but not required to be identical to it.
    const offsetM = haversine(TRUE_POSITION, center);
    expect(offsetM).toBeGreaterThanOrEqual(0);
    expect(offsetM).toBeLessThan(1500);
  });

  it("recomputes real distance from the true position and filters to the mode radius", async () => {
    const near = place("near", 100);
    const mid = place("mid", 600);
    const far = place("far", 2000);
    const fetchNearby = mockFetchNearby(async () => [near, mid, far]);

    const result = await buildFeed(baseRequest({ mode: "walking" }), { fetchNearby });

    // Walking radius is 400m: only "near" (~100m) survives.
    expect(result.places.map((p) => p.id)).toEqual(["near"]);
    expect(result.places[0]?.distanceM).toBeLessThan(400);
  });

  it("widens what survives filtering as mode radius grows", async () => {
    const near = place("near", 100);
    const mid = place("mid", 600);
    const far = place("far", 2000);
    const fetchNearby = mockFetchNearby(async () => [near, mid, far]);

    const biking = await buildFeed(baseRequest({ mode: "biking" }), { fetchNearby });
    expect(biking.places.map((p) => p.id)).toEqual(["near", "mid"]);

    const driving = await buildFeed(baseRequest({ mode: "driving" }), { fetchNearby });
    expect(driving.places.map((p) => p.id)).toEqual(["near", "mid", "far"]);
  });

  it("sorts results by real distance, ascending, regardless of source order", async () => {
    const far = place("far", 2000);
    const near = place("near", 100);
    const mid = place("mid", 600);
    const fetchNearby = mockFetchNearby(async () => [far, near, mid]);

    const result = await buildFeed(baseRequest({ mode: "driving" }), { fetchNearby });
    expect(result.places.map((p) => p.id)).toEqual(["near", "mid", "far"]);
  });

  it("excludes places already heard this trip", async () => {
    const near = place("near", 100);
    const mid = place("mid", 600);
    const fetchNearby = mockFetchNearby(async () => [near, mid]);

    const result = await buildFeed(baseRequest({ mode: "biking", heardIds: ["near"] }), {
      fetchNearby,
    });
    expect(result.places.map((p) => p.id)).toEqual(["mid"]);
  });

  it("returns an empty feed when nothing is nearby", async () => {
    const fetchNearby = mockFetchNearby(async () => []);
    const result = await buildFeed(baseRequest(), { fetchNearby });
    expect(result.places).toEqual([]);
  });
});
