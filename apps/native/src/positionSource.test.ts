import { describe, expect, it, vi } from "vitest";
import type { GeolocationPlugin, WatchPositionCallback } from "@capacitor/geolocation";
import { CapacitorPositionSource } from "./positionSource.js";

function fakePlugin(): { plugin: GeolocationPlugin; emit: WatchPositionCallback } {
  let emit: WatchPositionCallback = () => {};
  const plugin = {
    watchPosition: vi.fn(async (_options, callback: WatchPositionCallback) => {
      emit = callback;
      return "watch-1";
    }),
    clearWatch: vi.fn(async () => {}),
    getCurrentPosition: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  } as unknown as GeolocationPlugin;
  return { plugin, emit: (position, err) => emit(position, err) };
}

describe("CapacitorPositionSource", () => {
  it("returns null before any fix arrives", () => {
    const { plugin } = fakePlugin();
    const source = new CapacitorPositionSource(plugin);
    expect(source.current()).toBeNull();
  });

  it("maps a Capacitor Position into a PositionFix, using reported speed/heading", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new CapacitorPositionSource(plugin);
    await source.start();

    emit({
      timestamp: 1_700_000_000_000,
      coords: {
        latitude: 27.9506,
        longitude: -82.4572,
        accuracy: 5,
        altitudeAccuracy: null,
        altitude: null,
        speed: 3.2,
        heading: 90,
        magneticHeading: undefined,
        trueHeading: undefined,
        headingAccuracy: undefined,
        course: undefined,
      },
    });

    const fix = source.current();
    expect(fix).not.toBeNull();
    expect(fix!.lat).toBeCloseTo(27.9506);
    expect(fix!.lon).toBeCloseTo(-82.4572);
    expect(fix!.speedMps).toBe(3.2);
    expect(fix!.headingDeg).toBe(90);
    expect(fix!.accuracyM).toBe(5);
  });

  it("derives speed/heading from consecutive fixes when the plugin reports null for both", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new CapacitorPositionSource(plugin);
    await source.start();

    const base = {
      accuracy: 5,
      altitudeAccuracy: null,
      altitude: null,
      speed: null,
      heading: null,
      magneticHeading: undefined,
      trueHeading: undefined,
      headingAccuracy: undefined,
      course: undefined,
    };

    emit({ timestamp: 1_700_000_000_000, coords: { ...base, latitude: 27.95, longitude: -82.45 } });
    emit({ timestamp: 1_700_000_010_000, coords: { ...base, latitude: 27.9510, longitude: -82.45 } });

    const fix = source.current();
    expect(fix!.speedMps).toBeGreaterThan(0);
    expect(Number.isFinite(fix!.headingDeg)).toBe(true);
  });

  it("records plugin errors via getError without touching the last good fix", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new CapacitorPositionSource(plugin);
    await source.start();

    emit(null, { name: "Error", message: "location unavailable" });

    expect(source.getError()).toBe("location unavailable");
    expect(source.current()).toBeNull();
  });

  it("stop() clears the watch by id", async () => {
    const { plugin } = fakePlugin();
    const source = new CapacitorPositionSource(plugin);
    await source.start();
    await source.stop();
    expect(plugin.clearWatch).toHaveBeenCalledWith({ id: "watch-1" });
  });
});
