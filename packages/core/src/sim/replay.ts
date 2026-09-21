import { bearing, haversine } from "../geo/index.js";
import type { TrackPoint } from "./gpx.js";

/**
 * A single position reading, whether it came from the browser's Geolocation
 * API, a native background-location plugin, or (in development) the
 * simulator below. This is the one shape the rest of the core loop consumes,
 * which is what makes the native wrapper a `PositionSource` swap rather than
 * a scheduler rewrite (PLAN.md §2.1).
 */
export interface PositionFix {
  lat: number;
  lon: number;
  /** Milliseconds since the replay/session started. */
  timestampMs: number;
  speedMps: number;
  /** Compass heading, degrees 0-360. */
  headingDeg: number;
  accuracyM?: number;
}

/**
 * Anything that can be polled for the current position fix. Production
 * implementations (browser geolocation, native background location) live
 * outside `packages/core`, since they're the platform-specific edge —
 * `packages/core` only depends on this interface.
 */
export interface PositionSource {
  /** Returns the current fix, or `null` if none is available (yet, or ever). */
  current(): PositionFix | null;
}

/**
 * Replays a parsed GPX track as a pure function of elapsed time. No timers,
 * no subscriptions: the caller (a test, or the app's polling loop paired
 * with a {@link import("./clock.js").Clock}) asks "where was the track at
 * elapsed time T" and gets back an interpolated fix, or `null` once the
 * track has finished.
 *
 * Points are placed on a timeline using each point's GPX `<time>` if
 * present; otherwise points are spaced one second apart. Speed and heading
 * for a fix are derived from the bracketing segment, not stored on the
 * point, since GPX doesn't carry either.
 */
export class TrackReplayer {
  private readonly points: ReadonlyArray<{ lat: number; lon: number; tMs: number }>;
  private readonly totalDurationMs: number;

  constructor(track: readonly TrackPoint[]) {
    if (track.length < 2) {
      throw new Error("TrackReplayer requires at least 2 track points");
    }

    const baseTimeMs = track[0]?.time ? Date.parse(track[0].time) : 0;
    this.points = track.map((point, index) => ({
      lat: point.lat,
      lon: point.lon,
      tMs: point.time ? Date.parse(point.time) - baseTimeMs : index * 1000,
    }));

    const last = this.points[this.points.length - 1];
    if (last === undefined) throw new Error("unreachable: points is non-empty");
    this.totalDurationMs = last.tMs;
  }

  /** Total simulated duration of the track, in milliseconds. */
  get durationMs(): number {
    return this.totalDurationMs;
  }

  /**
   * Returns the interpolated fix at `elapsedMs` since the start of the
   * track, or `null` if `elapsedMs` is before the start or after the track
   * has finished.
   */
  at(elapsedMs: number): PositionFix | null {
    if (elapsedMs < 0 || elapsedMs > this.totalDurationMs) return null;

    let i = 0;
    while (i < this.points.length - 2 && (this.points[i + 1]?.tMs ?? Infinity) <= elapsedMs) {
      i++;
    }
    const a = this.points[i];
    const b = this.points[i + 1];
    if (a === undefined || b === undefined) return null;

    const segDurMs = Math.max(b.tMs - a.tMs, 1);
    const frac = Math.min(Math.max((elapsedMs - a.tMs) / segDurMs, 0), 1);

    const lat = a.lat + (b.lat - a.lat) * frac;
    const lon = a.lon + (b.lon - a.lon) * frac;
    const segDistM = haversine(a, b);
    const speedMps = segDistM / (segDurMs / 1000);
    const headingDeg = bearing(a, b);

    return { lat, lon, timestampMs: elapsedMs, speedMps, headingDeg };
  }
}
