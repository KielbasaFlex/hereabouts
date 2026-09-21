import { beforeEach, describe, expect, it } from "vitest";
import {
  appendTripLogEntry,
  clearTripLog,
  isTripLogEnabled,
  loadTripLog,
  setTripLogEnabled,
  tripLogToGeoJson,
  tripLogToJson,
  type TripLogEntry,
  type TripLogStorage,
} from "./tripLog.js";

function fakeStorage(): TripLogStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const ENTRY: TripLogEntry = { placeId: "wikipedia:1", title: "Tampa Theatre", heardAt: "2024-01-01T00:00:00.000Z", lat: 27.95, lon: -82.46 };

describe("trip log consent", () => {
  it("is disabled by default", () => {
    expect(isTripLogEnabled(fakeStorage())).toBe(false);
  });

  it("can be enabled and disabled", () => {
    const storage = fakeStorage();
    setTripLogEnabled(true, storage);
    expect(isTripLogEnabled(storage)).toBe(true);
    setTripLogEnabled(false, storage);
    expect(isTripLogEnabled(storage)).toBe(false);
  });
});

describe("appendTripLogEntry", () => {
  it("does not record anything when the trip log isn't enabled", () => {
    const storage = fakeStorage();
    const entries = appendTripLogEntry(ENTRY, storage);
    expect(entries).toEqual([]);
    expect(loadTripLog(storage)).toEqual([]);
  });

  it("records an entry once enabled", () => {
    const storage = fakeStorage();
    setTripLogEnabled(true, storage);
    const entries = appendTripLogEntry(ENTRY, storage);
    expect(entries).toEqual([ENTRY]);
    expect(loadTripLog(storage)).toEqual([ENTRY]);
  });

  it("accumulates multiple entries in order", () => {
    const storage = fakeStorage();
    setTripLogEnabled(true, storage);
    const second: TripLogEntry = { ...ENTRY, placeId: "wikipedia:2", title: "Tampa City Hall" };
    appendTripLogEntry(ENTRY, storage);
    const entries = appendTripLogEntry(second, storage);
    expect(entries.map((e) => e.placeId)).toEqual(["wikipedia:1", "wikipedia:2"]);
  });
});

describe("loadTripLog", () => {
  it("returns an empty array when storage is corrupted rather than throwing", () => {
    const storage = fakeStorage();
    storage.setItem("hereabouts:trip-log:entries:v1", "{not json");
    expect(loadTripLog(storage)).toEqual([]);
  });
});

describe("clearTripLog", () => {
  it("removes recorded entries but leaves the consent choice untouched", () => {
    const storage = fakeStorage();
    setTripLogEnabled(true, storage);
    appendTripLogEntry(ENTRY, storage);
    clearTripLog(storage);
    expect(loadTripLog(storage)).toEqual([]);
    expect(isTripLogEnabled(storage)).toBe(true);
  });
});

describe("export formats", () => {
  let entries: TripLogEntry[];

  beforeEach(() => {
    entries = [ENTRY];
  });

  it("serialises to indented JSON", () => {
    const json = tripLogToJson(entries);
    expect(JSON.parse(json)).toEqual(entries);
    expect(json).toContain("\n"); // indented, not minified
  });

  it("serialises to a GeoJSON FeatureCollection with [lon, lat] order", () => {
    const geojson = tripLogToGeoJson(entries);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features[0]?.geometry.coordinates).toEqual([-82.46, 27.95]);
    expect(geojson.features[0]?.properties).toEqual({
      placeId: "wikipedia:1",
      title: "Tampa Theatre",
      heardAt: "2024-01-01T00:00:00.000Z",
    });
  });
});
