import type { PlaceEvent } from "@hereabouts/contracts";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { placesToGeoJson } from "../map/toGeoJson";

/**
 * A free, no-API-key vector style (self-hostable — see PLAN.md §16.3's
 * precedent for Overpass/OSRM: this dev default is not a production
 * commitment). Overridable via `VITE_MAP_STYLE_URL` for a self-hosted style
 * in production, without a code change.
 */
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const PLACES_SOURCE_ID = "hereabouts-places";
const PLACES_LAYER_ID = "hereabouts-places-layer";

export interface MapPosition {
  lat: number;
  lon: number;
}

export interface MapViewProps {
  position: MapPosition | null;
  places: PlaceEvent[];
}

/**
 * Milestone 4's map view: the user's live/simulated position plus nearby
 * candidate places, both pushed imperatively into a MapLibre instance
 * created once on mount (recreating the map on every position/places update
 * would flash the view and reset zoom/pan).
 *
 * **Never crashes the app if tiles can't load.** This environment's own
 * egress proxy blocks every tile/style host tried during development —
 * the same category of live-network dependency as the Wikipedia/Wikidata/
 * Overpass adapters (see `SOURCES.md`) — so the failure path here is
 * exercised by every local run: MapLibre's own `error` event is caught and
 * shown as an inline note instead of an unhandled rejection or a blank
 * crash, and the rest of the app (text card, controls) is untouched by it.
 */
export function MapView({ position, places }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const positionMarkerRef = useRef<Marker | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const styleUrl = import.meta.env.VITE_MAP_STYLE_URL ?? DEFAULT_STYLE_URL;
    const map = new maplibregl.Map({
      container,
      style: styleUrl,
      center: position ? [position.lon, position.lat] : [0, 0],
      zoom: 15,
    });
    mapRef.current = map;

    map.on("error", (e) => {
      console.warn("MapLibre error — map tiles may be unreachable:", e.error?.message ?? e);
      setTilesFailed(true);
    });

    map.on("load", () => {
      map.addSource(PLACES_SOURCE_ID, { type: "geojson", data: placesToGeoJson([]) });
      map.addLayer({
        id: PLACES_LAYER_ID,
        type: "circle",
        source: PLACES_SOURCE_ID,
        paint: {
          "circle-radius": 7,
          "circle-color": "#c1440e",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Created once; position/places are pushed via the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(placesToGeoJson(places));
  }, [places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;

    if (!positionMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "map-view__position-dot";
      positionMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([position.lon, position.lat])
        .addTo(map);
    } else {
      positionMarkerRef.current.setLngLat([position.lon, position.lat]);
    }
    map.easeTo({ center: [position.lon, position.lat], duration: 500 });
  }, [position?.lat, position?.lon]);

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" />
      {tilesFailed && (
        <p className="map-view__fallback-note">Map tiles unavailable right now — everything else still works.</p>
      )}
    </div>
  );
}
