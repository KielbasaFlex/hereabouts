import { describe, expect, it } from "vitest";
import { haversine, type LatLon } from "../geo/index.js";
import { CORRIDOR_BUFFER_RADIUS_M, sampleCorridor } from "./index.js";

describe("sampleCorridor", () => {
  it("returns an empty array for an empty polyline", () => {
    expect(sampleCorridor([], { mode: "driving" })).toEqual([]);
  });

  it("returns a single point unchanged for a single-point polyline", () => {
    const samples = sampleCorridor([{ lat: 10, lon: 20 }], { mode: "walking" });
    expect(samples).toEqual([
      { lat: 10, lon: 20, distanceAlongRouteM: 0, bufferRadiusM: CORRIDOR_BUFFER_RADIUS_M.walking },
    ]);
  });

  it("always includes the route's start and end points", () => {
    const polyline: LatLon[] = [
      { lat: 27.95, lon: -82.46 },
      { lat: 27.96, lon: -82.45 },
      { lat: 27.97, lon: -82.44 },
    ];
    const samples = sampleCorridor(polyline, { mode: "driving", spacingM: 100_000 }); // spacing wider than the whole route
    expect(samples[0]).toMatchObject({ lat: 27.95, lon: -82.46, distanceAlongRouteM: 0 });
    expect(samples[samples.length - 1]).toMatchObject({ lat: 27.97, lon: -82.44 });
  });

  it("samples at approximately the requested spacing along a straight line", () => {
    // A long north-south line so total length is easy to reason about.
    const polyline: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0.5, lon: 0 }, // ~55.6km north
    ];
    const samples = sampleCorridor(polyline, { mode: "driving", spacingM: 1000 });

    expect(samples.length).toBeGreaterThan(50); // ~55 intervals of 1000m over ~55.6km
    for (let i = 1; i < samples.length - 1; i++) {
      const gap = samples[i]!.distanceAlongRouteM - samples[i - 1]!.distanceAlongRouteM;
      expect(gap).toBeCloseTo(1000, 0);
    }
  });

  it("interpolates coordinates consistent with actual distance along each leg", () => {
    const polyline: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 }, // due east, ~111km
    ];
    const samples = sampleCorridor(polyline, { mode: "driving", spacingM: 50_000 });
    // Every sample must lie on the straight lat=0 line, monotonically increasing in lon.
    for (const sample of samples) {
      expect(sample.lat).toBeCloseTo(0, 6);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.lon).toBeGreaterThan(samples[i - 1]!.lon);
    }
  });

  it("handles a polyline with duplicate consecutive points without producing NaN", () => {
    const polyline: LatLon[] = [
      { lat: 10, lon: 10 },
      { lat: 10, lon: 10 },
      { lat: 10.01, lon: 10 },
    ];
    const samples = sampleCorridor(polyline, { mode: "walking", spacingM: 200 });
    for (const sample of samples) {
      expect(Number.isNaN(sample.lat)).toBe(false);
      expect(Number.isNaN(sample.lon)).toBe(false);
    }
  });

  it("assigns the mode's buffer radius to every sample", () => {
    const polyline: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0 },
    ];
    const samples = sampleCorridor(polyline, { mode: "biking", spacingM: 200 });
    for (const sample of samples) {
      expect(sample.bufferRadiusM).toBe(CORRIDOR_BUFFER_RADIUS_M.biking);
    }
  });

  it("covers the full route distance — last sample's distance matches the summed leg lengths", () => {
    const polyline: LatLon[] = [
      { lat: 27.95, lon: -82.46 },
      { lat: 27.955, lon: -82.455 },
      { lat: 27.96, lon: -82.45 },
    ];
    let totalM = 0;
    for (let i = 1; i < polyline.length; i++) totalM += haversine(polyline[i - 1]!, polyline[i]!);

    const samples = sampleCorridor(polyline, { mode: "driving", spacingM: 500 });
    expect(samples[samples.length - 1]!.distanceAlongRouteM).toBeCloseTo(totalM, 0);
  });
});
