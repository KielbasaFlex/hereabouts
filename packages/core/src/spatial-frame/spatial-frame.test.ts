import { describe, expect, it } from "vitest";
import { computeSpatialFrame } from "./index.js";

const OBSERVER_BASE = { lat: 0, lon: 0 };

/** A point due east of the equator observer, `distanceM` away (approx, flat-earth, test-only). */
function pointEast(distanceM: number) {
  const metersPerDegLon = 111_320; // cos(0) = 1 at the equator
  return { lat: 0, lon: distanceM / metersPerDegLon };
}

describe("computeSpatialFrame", () => {
  it("allows directional language for a very close, strongly-aligned target", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 90 }; // heading east
    const target = pointEast(20); // 20m ahead, walking mode's directional threshold is 50m
    const frame = computeSpatialFrame(observer, target, "walking");
    expect(frame.allow).toBe("directional");
    expect(frame.side).toBe("ahead");
  });

  it("classifies a target to the right of straight-ahead travel", () => {
    const observer = { lat: 0, lon: 0, headingDeg: 0 }; // heading north
    const target = { lat: 0.0002, lon: 0.0002 }; // north-east-ish: right of due north, close
    const frame = computeSpatialFrame(observer, target, "walking");
    expect(frame.allow).toBe("directional");
    expect(frame.side).toBe("right");
  });

  it("falls back to proximal when close but not well-aligned with heading", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 0 }; // heading north
    const target = pointEast(20); // due east — off to the side, not ahead
    const frame = computeSpatialFrame(observer, target, "walking");
    expect(frame.allow).toBe("proximal");
    expect(frame.side).toBeNull();
  });

  it("falls back to proximal when aligned but beyond the mode's directional distance", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 90 };
    const target = pointEast(500); // well aligned, but 500m > walking's 50m directional cutoff
    const frame = computeSpatialFrame(observer, target, "walking");
    expect(frame.allow).toBe("proximal");
  });

  it("widens the directional distance for driving vs. walking", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 90 };
    const target = pointEast(120); // beyond walking's 50m, within driving's 150m
    expect(computeSpatialFrame(observer, target, "walking").allow).toBe("proximal");
    expect(computeSpatialFrame(observer, target, "driving").allow).toBe("directional");
  });

  it("falls back to regional beyond the proximal distance", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 90 };
    const target = pointEast(5000);
    const frame = computeSpatialFrame(observer, target, "driving");
    expect(frame.allow).toBe("regional");
    expect(frame.side).toBeNull();
  });

  it("always reports the real distance regardless of allowance tier", () => {
    const observer = { ...OBSERVER_BASE, headingDeg: 90 };
    const target = pointEast(3000);
    const frame = computeSpatialFrame(observer, target, "driving");
    expect(frame.distanceM).toBeGreaterThan(2900);
    expect(frame.distanceM).toBeLessThan(3100);
  });
});
