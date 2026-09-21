import type { CorridorPoint } from "../corridor/index.js";

/**
 * Slippy-map tile coordinate math (the "XYZ"/Web Mercator scheme every
 * PMTiles/MapLibre-compatible tileset uses), for computing which tiles a
 * route corridor's PMTiles slice needs (PLAN.md §11 step 5).
 *
 * This is deliberately *only* the coordinate math, not a PMTiles
 * reader/writer or a tile fetcher. Actually producing and hosting the
 * `.pmtiles` byte data is a self-hosted data-pipeline step (`go-pmtiles`/
 * `tippecanoe`/`planetiler` against an OSM extract) — the same "self-host
 * for production, this codebase doesn't reimplement the infra" posture
 * `SOURCES.md` already takes for OSRM. What a real slicing step needs is
 * exactly the tile list this module computes.
 */

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * Converts a lon/lat point to its containing tile at zoom `z`, using the
 * standard Web Mercator slippy-map formula.
 */
export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

  // Clamp rather than throw for a point exactly on the antimeridian/poles,
  // where floating-point rounding can land one unit outside [0, n).
  const clamp = (v: number) => Math.min(Math.max(v, 0), n - 1);
  return { z, x: clamp(x), y: clamp(y) };
}

function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

export interface CorridorTileSetOptions {
  minZoom: number;
  maxZoom: number;
}

/**
 * The set of tiles a corridor's samples fall into, across a zoom range —
 * the tile list a PMTiles corridor slice (PLAN.md §11 step 5) needs to
 * cover. Deliberately just "the tile each sample point is in," not a
 * buffered union around each point: a production slicing step should still
 * pad this by a tile of margin so a place near a tile edge isn't cut off,
 * exactly as it would pad any bounding-box extract.
 */
export function corridorTileSet(points: readonly CorridorPoint[], options: CorridorTileSetOptions): TileCoord[] {
  const seen = new Map<string, TileCoord>();
  for (const point of points) {
    for (let z = options.minZoom; z <= options.maxZoom; z++) {
      const tile = lonLatToTile(point.lon, point.lat, z);
      seen.set(tileKey(tile), tile);
    }
  }
  return [...seen.values()];
}
