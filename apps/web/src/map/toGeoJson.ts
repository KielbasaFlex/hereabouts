import type { PlaceEvent } from "@hereabouts/contracts";

/**
 * A minimal, locally-defined GeoJSON shape rather than importing the
 * `geojson` package's ambient types — structurally compatible with what
 * MapLibre's `GeoJSONSource.setData` expects, without pulling in another
 * dependency just for a type.
 */
export interface PlaceFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; title: string; distanceM: number | null };
}

export interface PlaceFeatureCollection {
  type: "FeatureCollection";
  features: PlaceFeature[];
}

/**
 * Converts the feed's places into a GeoJSON `FeatureCollection` for
 * `MapView` (Milestone 4): one source updated via `setData` on every feed
 * poll, rather than diffing individual DOM markers by hand.
 */
export function placesToGeoJson(places: readonly PlaceEvent[]): PlaceFeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
      properties: { id: place.id, title: place.title, distanceM: place.distanceM ?? null },
    })),
  };
}
