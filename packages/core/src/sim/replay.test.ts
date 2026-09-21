import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { haversine } from "../geo/index.js";
import { parseGpx, type TrackPoint } from "./gpx.js";
import { TrackReplayer } from "./replay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = join(__dirname, "../../../../tracks");

function loadTrack(filename: string): TrackPoint[] {
  const xml = readFileSync(join(TRACKS_DIR, filename), "utf8");
  return parseGpx(xml);
}

describe("TrackReplayer — synthetic two-point track", () => {
  it("interpolates position linearly between two points", () => {
    const track: TrackPoint[] = [
      { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
      { lat: 0, lon: 0.01, time: "2026-01-01T00:00:10Z" },
    ];
    const replayer = new TrackReplayer(track);

    expect(replayer.durationMs).toBe(10_000);

    const start = replayer.at(0);
    expect(start).toMatchObject({ lat: 0, lon: 0 });

    const mid = replayer.at(5000);
    expect(mid?.lat).toBeCloseTo(0);
    expect(mid?.lon).toBeCloseTo(0.005);

    const end = replayer.at(10_000);
    expect(end).toMatchObject({ lat: 0, lon: 0.01 });
  });

  it("computes speed from the segment's real distance and duration", () => {
    const track: TrackPoint[] = [
      { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
      { lat: 0, lon: 0.01, time: "2026-01-01T00:00:10Z" },
    ];
    const replayer = new TrackReplayer(track);
    const distanceM = haversine(track[0]!, track[1]!);
    const fix = replayer.at(2000);
    expect(fix?.speedMps).toBeCloseTo(distanceM / 10, 3);
  });

  it("returns null before the start and after the track ends", () => {
    const track: TrackPoint[] = [
      { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
      { lat: 0, lon: 0.01, time: "2026-01-01T00:00:10Z" },
    ];
    const replayer = new TrackReplayer(track);
    expect(replayer.at(-1)).toBeNull();
    expect(replayer.at(10_001)).toBeNull();
  });

  it("falls back to one-second spacing when points have no timestamps", () => {
    const track: TrackPoint[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
      { lat: 0, lon: 0.002 },
    ];
    const replayer = new TrackReplayer(track);
    expect(replayer.durationMs).toBe(2000);
  });

  it("throws for a track with fewer than two points", () => {
    expect(() => new TrackReplayer([{ lat: 0, lon: 0 }])).toThrow();
  });
});

describe("TrackReplayer — sample tracks (M0 GPS simulator smoke test)", () => {
  it("replays the highway drive at highway speed end-to-end", () => {
    const track = loadTrack("highway-drive.gpx");
    const replayer = new TrackReplayer(track);

    // 240 five-second steps at 29 m/s == 1200 simulated seconds.
    expect(replayer.durationMs).toBe(1_200_000);

    const samples = [];
    for (let t = 0; t <= replayer.durationMs; t += 30_000) {
      const fix = replayer.at(t);
      expect(fix).not.toBeNull();
      samples.push(fix!);
    }

    // Every sample should read as highway-speed driving.
    for (const fix of samples) {
      expect(fix.speedMps).toBeGreaterThan(25);
      expect(fix.speedMps).toBeLessThan(33);
    }

    // The track finishes cleanly: nothing beyond the last point.
    expect(replayer.at(replayer.durationMs + 1)).toBeNull();
  });

  it("replays the downtown walk at walking speed, with a heading change at the turn", () => {
    const track = loadTrack("downtown-walk.gpx");
    const replayer = new TrackReplayer(track);

    const early = replayer.at(60_000); // well into the first (eastbound) leg
    const late = replayer.at(replayer.durationMs - 60_000); // well into the second (northbound) leg

    expect(early?.speedMps).toBeCloseTo(1.3, 1);
    expect(late?.speedMps).toBeCloseTo(1.3, 1);

    // First leg heads east (~90°), second heads north (~0°): the walk turns.
    expect(early?.headingDeg).toBeCloseTo(90, 0);
    expect(late?.headingDeg).toBeCloseTo(0, 0);
  });

  it("replays the coastal bike ride at cycling speed", () => {
    const track = loadTrack("coastal-bike.gpx");
    const replayer = new TrackReplayer(track);

    const fix = replayer.at(replayer.durationMs / 2);
    expect(fix?.speedMps).toBeCloseTo(5.0, 1);
  });
});
