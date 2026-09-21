import { describe, expect, it } from "vitest";
import { ModeClassifier, type Mode } from "./index.js";

/**
 * Feeds a classifier a constant speed at 1 Hz for `seconds` samples,
 * starting at `startMs`, and returns the mode observed after each sample.
 */
function runConstantSpeed(
  classifier: ModeClassifier,
  speedMps: number,
  seconds: number,
  startMs: number,
): Mode[] {
  const modes: Mode[] = [];
  for (let i = 0; i < seconds; i++) {
    const { mode } = classifier.update(speedMps, startMs + i * 1000);
    modes.push(mode);
  }
  return modes;
}

describe("ModeClassifier", () => {
  it("starts stationary and stays stationary at zero speed", () => {
    const classifier = new ModeClassifier();
    const modes = runConstantSpeed(classifier, 0, 5, 0);
    expect(modes.every((m) => m === "stationary")).toBe(true);
  });

  it("does not switch to walking before the 10s enter-dwell elapses", () => {
    const classifier = new ModeClassifier();
    const modes = runConstantSpeed(classifier, 1.0, 15, 0);
    // Indices 0-8 are t=0..8s: still within the dwell window.
    expect(modes.slice(0, 9).every((m) => m === "stationary")).toBe(true);
    // Index 9 is t=9s... dwell isn't satisfied until t=10s (index 10).
    expect(modes[10]).toBe("walking");
    expect(modes[14]).toBe("walking");
  });

  it("does not switch to biking before its 15s enter-dwell elapses", () => {
    const classifier = new ModeClassifier();
    const modes = runConstantSpeed(classifier, 5.0, 20, 0);
    expect(modes.slice(0, 14).every((m) => m === "stationary")).toBe(true);
    expect(modes[15]).toBe("biking");
  });

  it("does not switch to driving before its 20s enter-dwell elapses", () => {
    const classifier = new ModeClassifier();
    const modes = runConstantSpeed(classifier, 20.0, 25, 0);
    expect(modes.slice(0, 19).every((m) => m === "stationary")).toBe(true);
    expect(modes[20]).toBe("driving");
  });

  it("does not flicker out of biking on a brief dip into the walking band", () => {
    const classifier = new ModeClassifier({ initialMode: "biking" });
    // Prime the EWMA at a firm biking speed first.
    for (let i = 0; i < 10; i++) classifier.update(5.0, i * 1000);
    expect(classifier.currentMode).toBe("biking");

    // A short dip (well under biking's exit threshold of 1.8 m/s smoothed,
    // and far under any dwell) should not flip the mode.
    const dipModes: Mode[] = [];
    for (let i = 10; i < 13; i++) {
      dipModes.push(classifier.update(1.5, i * 1000).mode);
    }
    expect(dipModes.every((m) => m === "biking")).toBe(true);
  });

  it("does not flip out of driving during a traffic jam (brief slowdown under the exit dwell)", () => {
    const classifier = new ModeClassifier({ initialMode: "driving" });
    const allModes: Mode[] = [];

    // Firmly establish driving at highway speed.
    let t = 0;
    for (let i = 0; i < 10; i++, t += 1000) {
      allModes.push(classifier.update(20, t).mode);
    }

    // Traffic jam: crawl at walking speed for 25s — under driving's 30s
    // exit dwell, so this must never register as anything but driving.
    for (let i = 0; i < 25; i++, t += 1000) {
      allModes.push(classifier.update(1.0, t).mode);
    }

    // Traffic clears; back to highway speed.
    for (let i = 0; i < 10; i++, t += 1000) {
      allModes.push(classifier.update(20, t).mode);
    }

    expect(allModes.every((m) => m === "driving")).toBe(true);
  });

  it("does eventually exit driving when the slowdown is sustained past the exit dwell", () => {
    const classifier = new ModeClassifier({ initialMode: "driving" });
    let t = 0;
    for (let i = 0; i < 10; i++, t += 1000) classifier.update(20, t);
    expect(classifier.currentMode).toBe("driving");

    // Sustained near-stop, comfortably longer than the 30s exit dwell plus
    // the EWMA settling time plus stationary's 15s enter dwell.
    let lastMode: Mode = classifier.currentMode;
    for (let i = 0; i < 70; i++, t += 1000) {
      lastMode = classifier.update(0.1, t).mode;
    }

    expect(lastMode).toBe("stationary");
  });

  it("smooths a single noisy spike rather than reacting to it directly", () => {
    const classifier = new ModeClassifier();
    // One wild GPS glitch reading 30 m/s amid otherwise stationary samples.
    classifier.update(0, 0);
    const { mode, smoothedSpeedMps } = classifier.update(30, 1000);
    expect(mode).toBe("stationary");
    // EWMA (alpha 0.3) pulls the spike down; nowhere near the raw 30.
    expect(smoothedSpeedMps).toBeLessThan(15);
  });
});
