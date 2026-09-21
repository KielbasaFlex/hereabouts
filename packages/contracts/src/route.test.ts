import { describe, expect, it } from "vitest";
import { Route } from "./route.js";

describe("Route", () => {
  it("accepts a well-formed route", () => {
    const result = Route.safeParse({
      points: [
        { lat: 27.95, lon: -82.46 },
        { lat: 27.96, lon: -82.45 },
      ],
      distanceM: 612.4,
      durationS: 98.7,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty points array", () => {
    const result = Route.safeParse({ points: [], distanceM: 0, durationS: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range coordinate", () => {
    const result = Route.safeParse({ points: [{ lat: 999, lon: 0 }], distanceM: 0, durationS: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative distance", () => {
    const result = Route.safeParse({ points: [{ lat: 0, lon: 0 }], distanceM: -1, durationS: 0 });
    expect(result.success).toBe(false);
  });
});
