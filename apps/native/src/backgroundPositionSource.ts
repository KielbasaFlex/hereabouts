import { bearing as computeBearing, haversine } from "@hereabouts/core/geo";
import type { PositionFix, PositionSource } from "@hereabouts/core/sim";
import type { BackgroundGeolocationPlugin, CallbackError, Location } from "@capacitor-community/background-geolocation";

/**
 * Background-capable `PositionSource` backed by
 * `@capacitor-community/background-geolocation` (PLAN.md §2.1/§10,
 * Milestone 7's "background geolocation" exit criterion). This is the
 * `PositionSource` implementation that makes continuous live narration
 * survive the phone being locked or the app backgrounded — the one thing
 * `LiveGeolocationSource` (browser) and `CapacitorPositionSource`
 * (foreground-only native) both cannot do.
 *
 * It implements the exact same `PositionSource` interface as every other
 * position source in this project, so the scheduler, mode classifier, and
 * narration trigger in `packages/core` need no changes to consume it — the
 * core claim this milestone's spike exists to prove.
 */
export class BackgroundPositionSource implements PositionSource {
  private latest: PositionFix | null = null;
  private previous: Location | null = null;
  private watcherId: string | null = null;
  private lastError: string | null = null;
  private readonly startedAtMs = Date.now();

  constructor(
    private readonly plugin: BackgroundGeolocationPlugin,
    private readonly options: { backgroundTitle?: string; backgroundMessage: string },
  ) {}

  async start(): Promise<void> {
    if (this.watcherId !== null) return;
    this.watcherId = await this.plugin.addWatcher(
      {
        backgroundMessage: this.options.backgroundMessage,
        ...(this.options.backgroundTitle !== undefined ? { backgroundTitle: this.options.backgroundTitle } : {}),
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      (position?: Location, error?: CallbackError) => {
        if (error || !position) {
          this.lastError = error?.message ?? "unknown background geolocation error";
          return;
        }
        this.handlePosition(position);
      },
    );
  }

  async stop(): Promise<void> {
    if (this.watcherId !== null) {
      await this.plugin.removeWatcher({ id: this.watcherId });
      this.watcherId = null;
    }
  }

  current(): PositionFix | null {
    return this.latest;
  }

  getError(): string | null {
    return this.lastError;
  }

  private handlePosition(location: Location): void {
    const here = { lat: location.latitude, lon: location.longitude };
    const nowMs = location.time ?? Date.now();

    let speedMps = location.speed ?? undefined;
    let headingDeg = location.bearing ?? undefined;

    if (this.previous && this.previous.time !== null) {
      const previousPoint = { lat: this.previous.latitude, lon: this.previous.longitude };
      const dtSec = Math.max((nowMs - this.previous.time) / 1000, 0.001);
      if (speedMps == null) speedMps = haversine(previousPoint, here) / dtSec;
      if (headingDeg == null) headingDeg = computeBearing(previousPoint, here);
    }

    this.latest = {
      lat: here.lat,
      lon: here.lon,
      timestampMs: nowMs - this.startedAtMs,
      speedMps: speedMps ?? 0,
      headingDeg: headingDeg ?? 0,
      accuracyM: location.accuracy,
    };
    this.lastError = null;
    this.previous = location;
  }
}
