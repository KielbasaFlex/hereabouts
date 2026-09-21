import { describe, expect, it } from "vitest";
import { RoutePack, RoutePackRequest } from "./route-pack.js";

describe("RoutePackRequest", () => {
  it("accepts a trackId-based request", () => {
    const result = RoutePackRequest.safeParse({ mode: "walking", trackId: "downtown-walk" });
    expect(result.success).toBe(true);
  });

  it("accepts an origin/destination-based request", () => {
    const result = RoutePackRequest.safeParse({
      mode: "driving",
      origin: { lat: 27.95, lon: -82.46 },
      destination: { lat: 27.96, lon: -82.45 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request with neither trackId nor origin/destination", () => {
    const result = RoutePackRequest.safeParse({ mode: "walking" });
    expect(result.success).toBe(false);
  });

  it("rejects a request with both trackId and origin/destination", () => {
    const result = RoutePackRequest.safeParse({
      mode: "walking",
      trackId: "downtown-walk",
      origin: { lat: 27.95, lon: -82.46 },
      destination: { lat: 27.96, lon: -82.45 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a request with only origin, no destination", () => {
    const result = RoutePackRequest.safeParse({ mode: "walking", origin: { lat: 27.95, lon: -82.46 } });
    expect(result.success).toBe(false);
  });
});

const SAMPLE_PLACE = {
  id: "wikipedia:1",
  source: "wikipedia",
  sourceId: "1",
  title: "X",
  lat: 0,
  lon: 0,
  datePrecision: "unknown",
  summary: "s",
  sourceExcerpt: "e",
  sourceUrl: "https://example.org/x",
  license: "cc-by-sa-4.0",
};

const SAMPLE_STORY = {
  placeId: "wikipedia:1",
  lengthBucket: "walking",
  narration: "Some grounded narration.",
  citations: [],
  validationStatus: "template_fallback",
  model: "template",
  promptVersion: "v1",
  cached: false,
};

describe("RoutePack", () => {
  it("accepts a well-formed pack", () => {
    const result = RoutePack.safeParse({
      packId: "pack-1",
      mode: "walking",
      route: { points: [{ lat: 0, lon: 0 }], distanceM: 0, durationS: 0 },
      places: [SAMPLE_PLACE],
      stories: [SAMPLE_STORY],
      tiles: [{ z: 14, x: 100, y: 200 }],
      attribution: ["Wikipedia, CC BY-SA 4.0"],
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty pack (no places found along the route)", () => {
    const result = RoutePack.safeParse({
      packId: "pack-2",
      mode: "driving",
      route: { points: [{ lat: 0, lon: 0 }], distanceM: 0, durationS: 0 },
      places: [],
      stories: [],
      tiles: [],
      attribution: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative tile coordinate", () => {
    const result = RoutePack.safeParse({
      packId: "pack-3",
      mode: "walking",
      route: { points: [{ lat: 0, lon: 0 }], distanceM: 0, durationS: 0 },
      places: [],
      stories: [],
      tiles: [{ z: -1, x: 0, y: 0 }],
      attribution: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
