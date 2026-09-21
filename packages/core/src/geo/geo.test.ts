import { describe, expect, it } from "vitest";
import {
  aheadness,
  angleDiffDeg,
  bearing,
  closestApproach,
  etaSeconds,
  haversine,
  normalizeDeg,
} from "./index.js";

describe("normalizeDeg", () => {
  it("wraps positive angles into [0, 360)", () => {
    expect(normalizeDeg(370)).toBeCloseTo(10);
    expect(normalizeDeg(360)).toBeCloseTo(0);
  });

  it("wraps negative angles into [0, 360)", () => {
    expect(normalizeDeg(-10)).toBeCloseTo(350);
    expect(normalizeDeg(-370)).toBeCloseTo(350);
  });
});

describe("haversine", () => {
  it("returns 0 for identical points", () => {
    const p = { lat: 27.9506, lon: -82.4572 };
    expect(haversine(p, p)).toBeCloseTo(0);
  });

  it("matches a known distance within tolerance", () => {
    // ~1 minute of latitude is ~1852 m (a nautical mile), independent of longitude.
    const a = { lat: 40, lon: -80 };
    const b = { lat: 40 + 1 / 60, lon: -80 };
    expect(haversine(a, b)).toBeCloseTo(1852, -1); // within ~10 m
  });

  it("is symmetric", () => {
    const a = { lat: 27.95, lon: -82.46 };
    const b = { lat: 27.96, lon: -82.44 };
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
  });
});

describe("bearing", () => {
  it("is 0 (north) for a point directly north", () => {
    const a = { lat: 40, lon: -80 };
    const b = { lat: 41, lon: -80 };
    expect(bearing(a, b)).toBeCloseTo(0, 1);
  });

  it("is 90 (east) for a point directly east on the equator", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 1 };
    expect(bearing(a, b)).toBeCloseTo(90, 1);
  });

  it("is 180 (south) for a point directly south", () => {
    const a = { lat: 40, lon: -80 };
    const b = { lat: 39, lon: -80 };
    expect(bearing(a, b)).toBeCloseTo(180, 1);
  });

  it("is 270 (west) for a point directly west on the equator", () => {
    const a = { lat: 0, lon: 1 };
    const b = { lat: 0, lon: 0 };
    expect(bearing(a, b)).toBeCloseTo(270, 1);
  });
});

describe("angleDiffDeg", () => {
  it("returns 0 for equal angles", () => {
    expect(angleDiffDeg(45, 45)).toBeCloseTo(0);
  });

  it("returns a positive value when turning right (clockwise) is shorter", () => {
    expect(angleDiffDeg(10, 30)).toBeCloseTo(20);
  });

  it("returns a negative value when turning left (counter-clockwise) is shorter", () => {
    expect(angleDiffDeg(30, 10)).toBeCloseTo(-20);
  });

  it("takes the short way around the 0/360 wrap", () => {
    expect(angleDiffDeg(350, 10)).toBeCloseTo(20);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(-20);
  });
});

describe("aheadness", () => {
  const observer = { lat: 40, lon: -80 };

  it("is ~1 when the target is directly ahead", () => {
    const target = { lat: 41, lon: -80 }; // due north
    expect(aheadness(observer, 0, target)).toBeCloseTo(1, 2);
  });

  it("is ~-1 when the target is directly behind", () => {
    const target = { lat: 41, lon: -80 }; // due north
    expect(aheadness(observer, 180, target)).toBeCloseTo(-1, 2);
  });

  it("is 0 when the target is exactly to the side", () => {
    // On the equator, a due-east target has an exact great-circle bearing
    // of 90°, so this checks a true right angle rather than an
    // approximation. (Off the equator, "same latitude" and "bearing 90°"
    // are not quite the same thing on a sphere — that's a real geometric
    // effect, not a bug, which is why this case is pinned to the equator.)
    const equatorObserver = { lat: 0, lon: 0 };
    const target = { lat: 0, lon: 1 }; // due east
    expect(aheadness(equatorObserver, 0, target)).toBeCloseTo(0, 6);
  });

  it("is close to 0 for a same-latitude target off the equator", () => {
    // Off the equator the great-circle bearing to a same-latitude point
    // isn't exactly 90°, so this only holds loosely.
    const target = { lat: 40, lon: -79 };
    expect(aheadness(observer, 0, target)).toBeCloseTo(0, 1);
  });
});

describe("closestApproach", () => {
  it("bundles distance, bearing, and aheadness consistently", () => {
    const observer = { lat: 40, lon: -80 };
    const target = { lat: 41, lon: -80 };
    const result = closestApproach(observer, 0, target);

    expect(result.distanceM).toBeCloseTo(haversine(observer, target), 6);
    expect(result.bearingDeg).toBeCloseTo(bearing(observer, target), 6);
    expect(result.aheadness).toBeCloseTo(1, 2);
  });
});

describe("etaSeconds", () => {
  it("divides distance by speed", () => {
    expect(etaSeconds(100, 10)).toBeCloseTo(10);
  });

  it("returns Infinity for a stationary observer", () => {
    expect(etaSeconds(100, 0)).toBe(Infinity);
  });

  it("returns Infinity for negligible speed rather than a huge finite number", () => {
    expect(etaSeconds(100, 0.01)).toBe(Infinity);
  });
});
