/**
 * Travel-mode classification from smoothed GPS speed.
 *
 * Naive threshold classification flickers constantly — a cyclist stopped at
 * a light reads as "stationary," a driver stuck in traffic reads as
 * "walking." This classifier fixes that with two independent mechanisms:
 *
 *  1. An EWMA over raw speed samples, so a single noisy fix can't move the
 *     needle.
 *  2. Hysteresis with dwell times: entering a new mode requires the smoothed
 *     speed to sit in that mode's band continuously for a minimum duration,
 *     and leaving a mode requires actually falling outside it (with its own,
 *     often longer, dwell for `driving`) rather than merely touching a
 *     neighbouring band.
 *
 * See PLAN.md §7.1 for the threshold table this implements.
 */

export type Mode = "stationary" | "walking" | "biking" | "driving";

interface EnterBand {
  test: (speedMps: number) => boolean;
  dwellSec: number;
}

const ENTER_BANDS: Record<Mode, EnterBand> = {
  stationary: { test: (s) => s < 0.4, dwellSec: 15 },
  walking: { test: (s) => s >= 0.4 && s <= 2.2, dwellSec: 10 },
  biking: { test: (s) => s > 2.2 && s <= 7.0, dwellSec: 15 },
  driving: { test: (s) => s > 7.0, dwellSec: 20 },
};

/**
 * Returns true when the smoothed speed has left the *current* mode's
 * protective band. For every mode except `driving` this is instantaneous;
 * `driving`'s exit additionally requires a sustained dwell (see
 * DRIVING_EXIT_DWELL_SEC), which is tracked separately in the classifier
 * because it can't be expressed as a stateless predicate.
 */
const EXIT_TESTS: Record<Mode, (speedMps: number) => boolean> = {
  stationary: (s) => s > 0.7,
  // Walking has no protective band of its own: you leave it the instant a
  // neighbouring mode's enter-condition starts being evaluated (whether
  // that neighbour actually confirms is gated by *its* dwell below).
  walking: (s) => s < 0.4 || s > 2.2,
  biking: (s) => s < 1.8 || s > 8.0,
  driving: (s) => s < 6.0,
};

const DRIVING_EXIT_DWELL_SEC = 30;

const MODE_ORDER: readonly Mode[] = ["stationary", "walking", "biking", "driving"];

function classifyBand(speedMps: number): Mode {
  for (const mode of MODE_ORDER) {
    if (ENTER_BANDS[mode].test(speedMps)) return mode;
  }
  // Unreachable: ENTER_BANDS is exhaustive over the real line by construction.
  /* istanbul ignore next */
  return "driving";
}

export interface ModeClassifierOptions {
  /** EWMA smoothing factor, 0-1. Higher weights recent samples more. Default 0.3. */
  alpha?: number;
  /** Starting mode before any samples arrive. Default "stationary". */
  initialMode?: Mode;
}

export interface ModeUpdateResult {
  mode: Mode;
  smoothedSpeedMps: number;
  /** The mode currently being confirmed via dwell, if a transition is pending. */
  pendingMode: Mode | null;
}

export class ModeClassifier {
  private readonly alpha: number;
  private ewmaSpeed = 0;
  private initialized = false;
  private mode: Mode;
  private pendingMode: Mode | null = null;
  private pendingSinceMs: number | null = null;
  private drivingExitCandidateSinceMs: number | null = null;

  constructor(options: ModeClassifierOptions = {}) {
    this.alpha = options.alpha ?? 0.3;
    this.mode = options.initialMode ?? "stationary";
  }

  get currentMode(): Mode {
    return this.mode;
  }

  get smoothedSpeedMps(): number {
    return this.ewmaSpeed;
  }

  /**
   * Feeds one speed sample (meters/second) at simulated or wall-clock time
   * `nowMs` (any monotonically non-decreasing millisecond timestamp) and
   * returns the classifier's updated state.
   */
  update(speedMps: number, nowMs: number): ModeUpdateResult {
    this.ewmaSpeed = this.initialized
      ? this.alpha * speedMps + (1 - this.alpha) * this.ewmaSpeed
      : speedMps;
    this.initialized = true;

    const exited = this.hasExitedCurrentMode(nowMs);

    if (!exited) {
      // Comfortably still in the current mode: cancel any pending switch
      // rather than letting a brief wobble accumulate dwell time.
      this.pendingMode = null;
      this.pendingSinceMs = null;
      return this.result();
    }

    const band = classifyBand(this.ewmaSpeed);
    if (band === this.mode) {
      // Shouldn't normally happen (exit implies we left the band), but is
      // safe: nothing to transition to.
      return this.result();
    }

    if (this.pendingMode !== band) {
      this.pendingMode = band;
      this.pendingSinceMs = nowMs;
    }

    const dwellMs = ENTER_BANDS[band].dwellSec * 1000;
    if (this.pendingSinceMs !== null && nowMs - this.pendingSinceMs >= dwellMs) {
      this.mode = band;
      this.pendingMode = null;
      this.pendingSinceMs = null;
      this.drivingExitCandidateSinceMs = null;
    }

    return this.result();
  }

  private hasExitedCurrentMode(nowMs: number): boolean {
    if (this.mode === "driving") {
      if (EXIT_TESTS.driving(this.ewmaSpeed)) {
        this.drivingExitCandidateSinceMs ??= nowMs;
        return nowMs - this.drivingExitCandidateSinceMs >= DRIVING_EXIT_DWELL_SEC * 1000;
      }
      this.drivingExitCandidateSinceMs = null;
      return false;
    }
    return EXIT_TESTS[this.mode](this.ewmaSpeed);
  }

  private result(): ModeUpdateResult {
    return {
      mode: this.mode,
      smoothedSpeedMps: this.ewmaSpeed,
      pendingMode: this.pendingMode,
    };
  }
}
