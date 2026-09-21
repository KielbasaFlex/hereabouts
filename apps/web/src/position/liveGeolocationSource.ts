import { bearing, haversine } from "@hereabouts/core/geo";
import type { PositionFix, PositionSource } from "@hereabouts/core/sim";

/**
 * Wraps the browser Geolocation API as a `PositionSource` (PLAN.md §2.1).
 * Nothing downstream of this file touches `navigator.geolocation` directly,
 * which is exactly what makes swapping in a native background-location
 * plugin (Milestone 7) a new implementation of this same interface rather
 * than a change to the scheduler, mode classifier, or UI.
 */
export class LiveGeolocationSource implements PositionSource {
  private latest: PositionFix | null = null;
  private previousCoords: GeolocationCoordinates | null = null;
  private previousTimestampMs: number | null = null;
  private watchId: number | null = null;
  private lastError: string | null = null;
  private readonly startedAtMs = Date.now();

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "geolocation" in navigator;
  }

  start(): void {
    if (this.watchId !== null || !LiveGeolocationSource.isSupported()) return;
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePosition(position),
      (error) => {
        this.lastError = error.message;
        console.warn("geolocation error:", error.message);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  current(): PositionFix | null {
    return this.latest;
  }

  getError(): string | null {
    return this.lastError;
  }

  private handlePosition(position: GeolocationPosition): void {
    const { coords } = position;
    const here = { lat: coords.latitude, lon: coords.longitude };

    // Prefer the browser's own speed/heading when available — both are
    // null while stationary, and not every device reports them at all —
    // falling back to deriving them from consecutive fixes.
    let speedMps = coords.speed ?? undefined;
    let headingDeg = coords.heading ?? undefined;

    if (this.previousCoords && this.previousTimestampMs !== null) {
      const previousPoint = { lat: this.previousCoords.latitude, lon: this.previousCoords.longitude };
      const dtSec = Math.max((position.timestamp - this.previousTimestampMs) / 1000, 0.001);
      if (speedMps === undefined) speedMps = haversine(previousPoint, here) / dtSec;
      if (headingDeg === undefined) headingDeg = bearing(previousPoint, here);
    }

    this.latest = {
      lat: here.lat,
      lon: here.lon,
      timestampMs: position.timestamp - this.startedAtMs,
      speedMps: speedMps ?? 0,
      headingDeg: headingDeg ?? 0,
      accuracyM: coords.accuracy,
    };
    this.lastError = null;
    this.previousCoords = coords;
    this.previousTimestampMs = position.timestamp;
  }
}
