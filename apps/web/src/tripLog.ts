/**
 * Trip log (PLAN.md §13/§11 V1 feature): a record of which places were
 * heard, when, and where. PLAN.md's design is a server-backed `trip`/
 * `trip_event` table gated by an account (§4.6, §12/M6) — none of that
 * exists yet, so this is a client-only stand-in: everything lives in
 * `localStorage`, never sent to the API or any third party. That's an
 * honest simplification, not the full feature — see the Milestone 4
 * caveats in `PLAN.md` for what a server-backed version still needs
 * (cross-device sync, account-deletion cascade).
 *
 * Still built to the same privacy posture PLAN.md §13 requires regardless
 * of where it's stored: **strictly opt-in** (nothing is recorded until
 * `setTripLogEnabled(true)` has been called), with one-tap export (JSON and
 * GeoJSON) and a hard delete.
 *
 * `storage` is injected (defaulting to `window.localStorage`) purely so
 * these functions are unit-testable without a real browser — the same
 * dependency-injection pattern used for `fetch`/the Anthropic client
 * elsewhere in this codebase.
 */

export interface TripLogEntry {
  placeId: string;
  title: string;
  /** ISO 8601 timestamp. */
  heardAt: string;
  lat: number;
  lon: number;
}

export interface TripLogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CONSENT_KEY = "hereabouts:trip-log:consent";
const ENTRIES_KEY = "hereabouts:trip-log:entries:v1";

export function isTripLogEnabled(storage: TripLogStorage): boolean {
  return storage.getItem(CONSENT_KEY) === "1";
}

export function setTripLogEnabled(enabled: boolean, storage: TripLogStorage): void {
  if (enabled) storage.setItem(CONSENT_KEY, "1");
  else storage.removeItem(CONSENT_KEY);
}

export function loadTripLog(storage: TripLogStorage): TripLogEntry[] {
  const raw = storage.getItem(ENTRIES_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TripLogEntry[]) : [];
  } catch {
    return []; // corrupted storage is treated as empty, never a crash
  }
}

/** Appends one entry and returns the updated log. No-op if the trip log isn't enabled. */
export function appendTripLogEntry(entry: TripLogEntry, storage: TripLogStorage): TripLogEntry[] {
  if (!isTripLogEnabled(storage)) return loadTripLog(storage);
  const entries = [...loadTripLog(storage), entry];
  storage.setItem(ENTRIES_KEY, JSON.stringify(entries));
  return entries;
}

/** The hard delete PLAN.md §13 requires — clears recorded entries, not the consent choice itself. */
export function clearTripLog(storage: TripLogStorage): void {
  storage.removeItem(ENTRIES_KEY);
}

export function tripLogToJson(entries: readonly TripLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export interface TripLogGeoJsonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { placeId: string; title: string; heardAt: string };
}

export interface TripLogGeoJsonCollection {
  type: "FeatureCollection";
  features: TripLogGeoJsonFeature[];
}

export function tripLogToGeoJson(entries: readonly TripLogEntry[]): TripLogGeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: entries.map((entry) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.lon, entry.lat] },
      properties: { placeId: entry.placeId, title: entry.title, heardAt: entry.heardAt },
    })),
  };
}
