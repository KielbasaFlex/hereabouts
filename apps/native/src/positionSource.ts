import { bearing, haversine } from "@hereabouts/core/geo";
import type { PositionFix, PositionSource } from "@hereabouts/core/sim";
import type { GeolocationPlugin, Position } from "@capacitor/geolocation";

/**
 * Foreground-only `PositionSource` backed by `@capacitor/geolocation`
 * (PLAN.md §2.1, Milestone 7). Structurally identical to
 * `apps/web/src/position/liveGeolocationSource.ts`'s `LiveGeolocationSource`
 * — same interface, same speed/heading-derivation-when-null fallback — the
 * only difference is the underlying watch API. `packages/core` needed zero
 * changes to accept this as a `PositionSource`.
 *
 * This does not track in the background: iOS/Android both suspend a
 * WebView's JS timers and the `watchPosition` callback once the app is
 * backgrounded (the same limitation the browser has). For actual background
 * tracking, see `BackgroundPositionSource`, which wraps a plugin built for
 * that purpose.
 */
export class CapacitorPositionSource implements PositionSource {
  private latest: PositionFix | null = null;
  private previousCoords: Position["coords"] | null = null;
  private previousTimestampMs: number | null = null;
  private watchId: string | null = null;
  private lastError: string | null = null;
  private readonly startedAtMs = Date.now();

  constructor(private readonly plugin: GeolocationPlugin) {}

  async start(): Promise<void> {
    if (this.watchId !== null) return;
    this.watchId = await this.plugin.watchPosition(
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
      (position, err) => {
        if (err || !position) {
          this.lastError = err?.message ?? "unknown geolocation error";
          return;
        }
        this.handlePosition(position);
      },
    );
  }

  async stop(): Promise<void> {
    if (this.watchId !== null) {
      await this.plugin.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
  }

  current(): PositionFix | null {
    return this.latest;
  }

  getError(): string | null {
    return this.lastError;
  }

  private handlePosition(position: Position): void {
    const { coords } = position;
    const here = { lat: coords.latitude, lon: coords.longitude };

    // Same fallback as LiveGeolocationSource: prefer the plugin's own
    // speed/heading, both nullable, and derive them from consecutive fixes
    // when absent.
    let speedMps = coords.speed ?? undefined;
    let headingDeg = coords.heading ?? undefined;

    if (this.previousCoords && this.previousTimestampMs !== null) {
      const previousPoint = { lat: this.previousCoords.latitude, lon: this.previousCoords.longitude };
      const dtSec = Math.max((position.timestamp - this.previousTimestampMs) / 1000, 0.001);
      if (speedMps == null) speedMps = haversine(previousPoint, here) / dtSec;
      if (headingDeg == null) headingDeg = bearing(previousPoint, here);
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
