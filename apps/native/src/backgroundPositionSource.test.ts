import { describe, expect, it, vi } from "vitest";
import type { BackgroundGeolocationPlugin, CallbackError, Location } from "@capacitor-community/background-geolocation";
import { BackgroundPositionSource } from "./backgroundPositionSource.js";

type Callback = (position?: Location, error?: CallbackError) => void;

function fakePlugin(): { plugin: BackgroundGeolocationPlugin; emit: Callback } {
  let emit: Callback = () => {};
  const plugin = {
    addWatcher: vi.fn(async (_options, callback: Callback) => {
      emit = callback;
      return "watcher-1";
    }),
    removeWatcher: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}),
  } as unknown as BackgroundGeolocationPlugin;
  return { plugin, emit: (position, error) => emit(position, error) };
}

function location(overrides: Partial<Location>): Location {
  return {
    latitude: 27.95,
    longitude: -82.45,
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    simulated: false,
    bearing: null,
    speed: null,
    time: 1_700_000_000_000,
    ...overrides,
  };
}

describe("BackgroundPositionSource", () => {
  const options = { backgroundMessage: "Hereabouts is narrating your route" };

  it("returns null before any fix arrives", () => {
    const { plugin } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    expect(source.current()).toBeNull();
  });

  it("requests background-capable watcher options, including requestPermissions and the message", async () => {
    const { plugin } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    await source.start();
    expect(plugin.addWatcher).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundMessage: options.backgroundMessage, requestPermissions: true }),
      expect.any(Function),
    );
  });

  it("maps a plugin Location into a PositionFix, using reported speed/bearing", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    await source.start();

    emit(location({ speed: 4.1, bearing: 180 }));

    const fix = source.current();
    expect(fix).not.toBeNull();
    expect(fix!.speedMps).toBe(4.1);
    expect(fix!.headingDeg).toBe(180);
    expect(fix!.accuracyM).toBe(5);
  });

  it("derives speed/heading from consecutive fixes when speed/bearing are null", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    await source.start();

    emit(location({ latitude: 27.95, longitude: -82.45, time: 1_700_000_000_000 }));
    emit(location({ latitude: 27.951, longitude: -82.45, time: 1_700_000_010_000 }));

    const fix = source.current();
    expect(fix!.speedMps).toBeGreaterThan(0);
    expect(Number.isFinite(fix!.headingDeg)).toBe(true);
  });

  it("records plugin errors via getError without touching the last good fix", async () => {
    const { plugin, emit } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    await source.start();

    emit(undefined, { name: "Error", message: "background permission denied" });

    expect(source.getError()).toBe("background permission denied");
    expect(source.current()).toBeNull();
  });

  it("stop() removes the watcher by id", async () => {
    const { plugin } = fakePlugin();
    const source = new BackgroundPositionSource(plugin, options);
    await source.start();
    await source.stop();
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: "watcher-1" });
  });
});
