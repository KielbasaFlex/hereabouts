import { describe, expect, it } from "vitest";
import { SystemClock, VirtualClock } from "./clock.js";

describe("VirtualClock", () => {
  it("starts at 0 by default", () => {
    expect(new VirtualClock().now()).toBe(0);
  });

  it("starts at the given time", () => {
    expect(new VirtualClock(1000).now()).toBe(1000);
  });

  it("advances by the given amount and returns the new time", () => {
    const clock = new VirtualClock();
    expect(clock.advance(500)).toBe(500);
    expect(clock.now()).toBe(500);
    expect(clock.advance(250)).toBe(750);
  });

  it("rejects a negative advance", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  it("can jump forward with set()", () => {
    const clock = new VirtualClock();
    clock.set(10_000);
    expect(clock.now()).toBe(10_000);
  });

  it("rejects moving backward with set()", () => {
    const clock = new VirtualClock(1000);
    expect(() => clock.set(500)).toThrow();
  });

  it("never moves on its own — only advance()/set() change it", () => {
    const clock = new VirtualClock();
    const before = clock.now();
    // No timers, no real-time dependency: time is exactly what we set it to.
    expect(clock.now()).toBe(before);
  });
});

describe("SystemClock", () => {
  it("tracks real wall-clock time", () => {
    const clock = new SystemClock();
    const before = Date.now();
    const reading = clock.now();
    const after = Date.now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(after);
  });
});
