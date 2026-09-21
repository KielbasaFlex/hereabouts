import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it } from "vitest";
import { placesToGeoJson } from "./toGeoJson.js";

function place(overrides: Partial<PlaceEvent> & Pick<PlaceEvent, "id" | "title" | "lat" | "lon">): PlaceEvent {
  return {
    source: "wikipedia",
    sourceId: overrides.id,
    datePrecision: "unknown",
    summary: "",
    sourceExcerpt: "",
    sourceUrl: "https://example.org",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.5,
    externalIds: {},
    isRegional: false,
    ...overrides,
  };
}

describe("placesToGeoJson", () => {
  it("converts an empty list to an empty feature collection", () => {
    expect(placesToGeoJson([])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("maps lon/lat into GeoJSON's [lon, lat] coordinate order", () => {
    const collection = placesToGeoJson([place({ id: "a", title: "A", lat: 27.95, lon: -82.46 })]);
    expect(collection.features[0]?.geometry.coordinates).toEqual([-82.46, 27.95]);
  });

  it("carries id, title, and distance into properties", () => {
    const collection = placesToGeoJson([
      place({ id: "wikipedia:1", title: "Tampa Theatre", lat: 0, lon: 0, distanceM: 123.4 }),
    ]);
    expect(collection.features[0]?.properties).toEqual({
      id: "wikipedia:1",
      title: "Tampa Theatre",
      distanceM: 123.4,
    });
  });

  it("uses null for a missing distance rather than undefined", () => {
    const collection = placesToGeoJson([place({ id: "a", title: "A", lat: 0, lon: 0 })]);
    expect(collection.features[0]?.properties.distanceM).toBeNull();
  });

  it("preserves input order and count", () => {
    const places = [
      place({ id: "a", title: "A", lat: 1, lon: 1 }),
      place({ id: "b", title: "B", lat: 2, lon: 2 }),
      place({ id: "c", title: "C", lat: 3, lon: 3 }),
    ];
    const collection = placesToGeoJson(places);
    expect(collection.features.map((f) => f.properties.id)).toEqual(["a", "b", "c"]);
  });
});
