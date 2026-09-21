import { XMLParser } from "fast-xml-parser";

/** A single trackpoint as parsed from a GPX file. */
export interface TrackPoint {
  lat: number;
  lon: number;
  /** Elevation in meters, if present. */
  ele?: number;
  /** ISO 8601 timestamp, if present. */
  time?: string;
}

interface RawTrkpt {
  lat: string;
  lon: string;
  ele?: string | number;
  time?: string;
}

interface RawTrkseg {
  trkpt?: RawTrkpt | RawTrkpt[];
}

interface RawTrk {
  name?: string;
  trkseg?: RawTrkseg | RawTrkseg[];
}

interface RawGpx {
  gpx?: {
    trk?: RawTrk | RawTrk[];
  };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parses a GPX 1.1 document's track points into a flat, chronologically
 * ordered list. Multiple `<trk>`/`<trkseg>` elements are concatenated in
 * document order. Waypoints and routes (`<wpt>`, `<rte>`) are ignored — the
 * simulator only replays tracks.
 */
export function parseGpx(xml: string): TrackPoint[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const doc = parser.parse(xml) as RawGpx;

  const points: TrackPoint[] = [];
  for (const trk of asArray(doc.gpx?.trk)) {
    for (const seg of asArray(trk.trkseg)) {
      for (const pt of asArray(seg.trkpt)) {
        const point: TrackPoint = {
          lat: Number.parseFloat(pt.lat),
          lon: Number.parseFloat(pt.lon),
        };
        if (pt.ele !== undefined) point.ele = Number.parseFloat(String(pt.ele));
        if (pt.time !== undefined) point.time = pt.time;
        points.push(point);
      }
    }
  }
  return points;
}
