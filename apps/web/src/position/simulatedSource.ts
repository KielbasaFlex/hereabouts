import {
  TrackReplayer,
  VirtualClock,
  type PositionFix,
  type PositionSource,
  type TrackPoint,
} from "@hereabouts/core/sim";

export interface SimulatedSourceOptions {
  /** Multiplier on real elapsed time, e.g. 4 = 4x real-time playback. Default 4. */
  playbackRate?: number;
}

/**
 * Drives a `TrackReplayer` with a `VirtualClock` advanced from real elapsed
 * time via `requestAnimationFrame`, scaled by a playback rate. This *is*
 * the "GPS simulator drives the whole loop end-to-end" M1 exit criterion:
 * it implements the same `PositionSource` interface as
 * {@link import("./liveGeolocationSource.js").LiveGeolocationSource}, so
 * the mode classifier, `/feed` polling, and narration playback can't tell
 * the difference between a real walk and a replayed one.
 */
export class SimulatedPositionSource implements PositionSource {
  private clock = new VirtualClock();
  private replayer: TrackReplayer | null = null;
  private playbackRate: number;
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private onFinish: (() => void) | null = null;

  constructor(options: SimulatedSourceOptions = {}) {
    this.playbackRate = options.playbackRate ?? 4;
  }

  /** Loads a new track, resetting playback to its start. */
  loadTrack(points: readonly TrackPoint[], onFinish?: () => void): void {
    this.stop();
    this.replayer = new TrackReplayer(points);
    this.clock = new VirtualClock(); // fresh instance: VirtualClock never moves backward
    this.onFinish = onFinish ?? null;
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
  }

  get durationMs(): number | null {
    return this.replayer?.durationMs ?? null;
  }

  get elapsedMs(): number {
    return this.clock.now();
  }

  start(): void {
    if (this.rafId !== null || !this.replayer) return;
    this.lastFrameMs = performance.now();

    const tick = (nowMs: number) => {
      const deltaMs = nowMs - (this.lastFrameMs ?? nowMs);
      this.lastFrameMs = nowMs;

      const replayer = this.replayer;
      if (replayer) {
        const next = this.clock.now() + deltaMs * this.playbackRate;
        if (next >= replayer.durationMs) {
          this.clock.set(replayer.durationMs);
          this.stop();
          this.onFinish?.();
          return;
        }
        this.clock.set(next);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameMs = null;
  }

  current(): PositionFix | null {
    return this.replayer ? this.replayer.at(this.clock.now()) : null;
  }
}
