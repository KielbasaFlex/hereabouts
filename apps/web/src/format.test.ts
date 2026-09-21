import { describe, expect, it } from "vitest";
import { formatDistance, formatMode, formatSpeed } from "./format";

describe("formatDistance", () => {
  it("formats sub-kilometer distances in meters", () => {
    expect(formatDistance(412)).toBe("412 m away");
    expect(formatDistance(0)).toBe("0 m away");
  });

  it("formats kilometer-plus distances in km with one decimal", () => {
    expect(formatDistance(1500)).toBe("1.5 km away");
    expect(formatDistance(12000)).toBe("12.0 km away");
  });

  it("handles missing or non-finite distance", () => {
    expect(formatDistance(undefined)).toBe("distance unknown");
    expect(formatDistance(Infinity)).toBe("distance unknown");
    expect(formatDistance(Number.NaN)).toBe("distance unknown");
  });
});

describe("formatMode", () => {
  it("capitalizes the first letter", () => {
    expect(formatMode("walking")).toBe("Walking");
    expect(formatMode("driving")).toBe("Driving");
  });

  it("handles an empty string without throwing", () => {
    expect(formatMode("")).toBe("");
  });
});

describe("formatSpeed", () => {
  it("converts meters/second to mph", () => {
    expect(formatSpeed(0)).toBe("0.0 mph");
    // 1 m/s ~= 2.237 mph
    expect(formatSpeed(1)).toBe("2.2 mph");
  });
});
