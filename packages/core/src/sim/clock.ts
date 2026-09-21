/**
 * Time abstraction so the scheduler and replay engine never call `Date.now()`
 * directly. Production wires a {@link SystemClock}; the GPS simulator and
 * all tests wire a {@link VirtualClock}, which is what lets the whole core
 * loop run deterministically, at any speed, with no wall-clock waiting.
 */
export interface Clock {
  /** Current time in milliseconds. Not required to be wall-clock time. */
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * A controllable clock for simulation and tests. Time only moves when
 * something calls {@link advance} or {@link set} — nothing here reads the
 * system clock or starts a timer.
 */
export class VirtualClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  /** Moves time forward by `ms` (must be >= 0) and returns the new time. */
  advance(ms: number): number {
    if (ms < 0) throw new Error("VirtualClock cannot advance by a negative amount");
    this.currentMs += ms;
    return this.currentMs;
  }

  /** Jumps directly to `ms`, which must not be earlier than the current time. */
  set(ms: number): void {
    if (ms < this.currentMs) {
      throw new Error("VirtualClock cannot move backward");
    }
    this.currentMs = ms;
  }
}
