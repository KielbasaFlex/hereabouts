import { describe, expect, it } from "vitest";
import { parseGpx } from "./gpx.js";

const SIMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Test track</name>
    <trkseg>
      <trkpt lat="27.950600" lon="-82.457200">
        <time>2026-01-15T15:00:00.000Z</time>
      </trkpt>
      <trkpt lat="27.950700" lon="-82.457100">
        <time>2026-01-15T15:00:10.000Z</time>
      </trkpt>
      <trkpt lat="27.950800" lon="-82.457000">
        <ele>12.5</ele>
        <time>2026-01-15T15:00:20.000Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("parseGpx", () => {
  it("parses trackpoints in document order", () => {
    const points = parseGpx(SIMPLE_GPX);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ lat: 27.9506, lon: -82.4572 });
    expect(points[1]).toMatchObject({ lat: 27.9507, lon: -82.4571 });
    expect(points[2]).toMatchObject({ lat: 27.9508, lon: -82.457, ele: 12.5 });
  });

  it("preserves timestamps", () => {
    const points = parseGpx(SIMPLE_GPX);
    expect(points[0]?.time).toBe("2026-01-15T15:00:00.000Z");
    expect(points[2]?.time).toBe("2026-01-15T15:00:20.000Z");
  });

  it("returns an empty array for a track with no points", () => {
    const empty = `<?xml version="1.0"?><gpx><trk><name>Empty</name></trk></gpx>`;
    expect(parseGpx(empty)).toEqual([]);
  });

  it("concatenates multiple track segments in order", () => {
    const multiSeg = `<?xml version="1.0"?>
<gpx>
  <trk>
    <trkseg>
      <trkpt lat="1" lon="1"><time>2026-01-01T00:00:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="2" lon="2"><time>2026-01-01T00:00:10Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const points = parseGpx(multiSeg);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ lat: 1, lon: 1 });
    expect(points[1]).toMatchObject({ lat: 2, lon: 2 });
  });
});
