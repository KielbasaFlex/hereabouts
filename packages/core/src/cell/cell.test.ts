import { describe, expect, it } from "vitest";
import { haversine } from "../geo/index.js";
import { cellCentroid, cellForPoint, COVERAGE_H3_RESOLUTION } from "./index.js";

describe("cellForPoint / cellCentroid", () => {
  it("is deterministic for the same point", () => {
    const p = { lat: 27.9506, lon: -82.4572 };
    expect(cellForPoint(p)).toBe(cellForPoint(p));
  });

  it("maps a point to a cell whose centroid is within one cell-width", () => {
    const p = { lat: 27.9506, lon: -82.4572 };
    const centroid = cellCentroid(cellForPoint(p));
    // Res-7 hexagons have an edge length of ~1.22 km; a point can be at most
    // roughly one edge length from its cell's centroid. This is the bound
    // that makes the privacy design (PLAN.md §13) work without destroying
    // locality: upstream sources see a point up to ~1.5 km off, never the
    // user's true position.
    expect(haversine(p, centroid)).toBeLessThan(1500);
  });

  it("maps distinct points far apart to different cells", () => {
    const tampa = { lat: 27.9506, lon: -82.4572 };
    const stPete = { lat: 27.7676, lon: -82.6403 };
    expect(cellForPoint(tampa)).not.toBe(cellForPoint(stPete));
  });

  it("documents the resolution it uses", () => {
    expect(COVERAGE_H3_RESOLUTION).toBe(7);
  });
});
