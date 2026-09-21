import { describe, expect, it } from "vitest";
import type { CorridorPoint } from "../corridor/index.js";
import { corridorTileSet, lonLatToTile } from "./index.js";

describe("lonLatToTile", () => {
  it("maps the single tile at zoom 0 for any point", () => {
    expect(lonLatToTile(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
    expect(lonLatToTile(-179, 89, 0)).toEqual({ z: 0, x: 0, y: 0 });
  });

  it("maps the prime-meridian/equator point to the exact center tile at any zoom", () => {
    // Derivable from the formula itself, not a memorized reference value:
    // lon=0 -> (0+180)/360*n = n/2 exactly; lat=0 -> tan(0)=0, so y = n/2 too.
    for (const z of [1, 4, 10, 16]) {
      const n = 2 ** z;
      expect(lonLatToTile(0, 0, z)).toEqual({ z, x: n / 2, y: n / 2 });
    }
  });

  it("increases x monotonically as longitude increases at fixed latitude/zoom", () => {
    const xs = [-90, -45, 0, 45, 90].map((lon) => lonLatToTile(lon, 10, 8).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
  });

  it("decreases y monotonically as latitude increases at fixed longitude/zoom (north is up)", () => {
    const ys = [-60, -30, 0, 30, 60].map((lat) => lonLatToTile(10, lat, 8).y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]!);
  });

  it("stays within [0, 2^z) even at the poles/antimeridian", () => {
    const n = 2 ** 5;
    for (const [lon, lat] of [[-180, 89.9], [180, -89.9], [180, 89.9]] as const) {
      const tile = lonLatToTile(lon, lat, 5);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(n);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(n);
    }
  });

  it("roughly doubles x/y when zooming in by one level, away from tile boundaries", () => {
    const low = lonLatToTile(12.3, 45.6, 10);
    const high = lonLatToTile(12.3, 45.6, 11);
    expect(high.x).toBeGreaterThanOrEqual(low.x * 2);
    expect(high.x).toBeLessThanOrEqual(low.x * 2 + 1);
    expect(high.y).toBeGreaterThanOrEqual(low.y * 2);
    expect(high.y).toBeLessThanOrEqual(low.y * 2 + 1);
  });
});

function point(lat: number, lon: number): CorridorPoint {
  return { lat, lon, distanceAlongRouteM: 0, bufferRadiusM: 500 };
}

describe("corridorTileSet", () => {
  it("returns one tile per zoom level for a single point", () => {
    const tiles = corridorTileSet([point(27.95, -82.46)], { minZoom: 10, maxZoom: 12 });
    expect(tiles).toHaveLength(3); // z10, z11, z12
    expect(new Set(tiles.map((t) => t.z))).toEqual(new Set([10, 11, 12]));
  });

  it("deduplicates tiles shared by nearby points", () => {
    const tiles = corridorTileSet(
      [point(27.95, -82.46), point(27.950001, -82.460001)], // effectively the same point
      { minZoom: 10, maxZoom: 10 },
    );
    expect(tiles).toHaveLength(1);
  });

  it("returns more tiles for points spread further apart", () => {
    const close = corridorTileSet([point(27.95, -82.46), point(27.9501, -82.4601)], { minZoom: 14, maxZoom: 14 });
    const far = corridorTileSet([point(27.95, -82.46), point(28.5, -83.0)], { minZoom: 14, maxZoom: 14 });
    expect(far.length).toBeGreaterThan(close.length);
  });

  it("returns an empty array for no points", () => {
    expect(corridorTileSet([], { minZoom: 10, maxZoom: 14 })).toEqual([]);
  });
});
