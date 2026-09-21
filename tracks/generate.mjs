#!/usr/bin/env node
/**
 * Generates the sample GPX tracks used by the GPS simulator (PLAN.md §14).
 * These are synthetic but geometrically sound: point spacing is computed
 * from a target speed and sample interval, so replaying a track back
 * through `TrackReplayer` reproduces that speed.
 *
 * Regenerate with: `node tracks/generate.mjs`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The web app (apps/web) fetches these at runtime for its GPS simulator UI
// (Vite's public/ dir is served as static files); this script is their
// single source of truth, so both copies are always in sync.
const WEB_PUBLIC_TRACKS_DIR = join(__dirname, "../apps/web/public/tracks");

function metersToDegLat(m) {
  return m / 111_320;
}

function metersToDegLon(m, atLatDeg) {
  return m / (111_320 * Math.cos((atLatDeg * Math.PI) / 180));
}

/**
 * Builds a multi-leg track. Each leg holds a constant heading and speed for
 * a duration, sampled at `intervalSec`. Legs are chained so the end of one
 * leg is the start of the next, with time continuing to advance across the
 * seam (no duplicated or reset timestamps).
 */
function buildTrack(startLat, startLon, startTime, legs) {
  let lat = startLat;
  let lon = startLon;
  let time = new Date(startTime);
  const points = [{ lat, lon, time: time.toISOString() }];

  for (const leg of legs) {
    const steps = Math.round(leg.durationSec / leg.intervalSec);
    const distPerStepM = leg.speedMps * leg.intervalSec;
    const headingRad = (leg.headingDeg * Math.PI) / 180;
    const dLat = metersToDegLat(distPerStepM * Math.cos(headingRad));
    const dLon = metersToDegLon(distPerStepM * Math.sin(headingRad), lat);

    for (let i = 1; i <= steps; i++) {
      lat += dLat;
      lon += dLon;
      time = new Date(time.getTime() + leg.intervalSec * 1000);
      points.push({ lat, lon, time: time.toISOString() });
    }
  }

  return points;
}

function toGpx(name, points) {
  const trkpts = points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">\n` +
        `        <time>${p.time}</time>\n` +
        `      </trkpt>`,
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="hereabouts-sim" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n` +
    `    <name>${name}</name>\n` +
    `    <trkseg>\n${trkpts}\n    </trkseg>\n` +
    `  </trk>\n` +
    `</gpx>\n`
  );
}

const tracks = [
  {
    file: "downtown-walk.gpx",
    name: "Downtown walk (sample)",
    startLat: 27.9506,
    startLon: -82.4572,
    startTime: "2026-01-15T15:00:00Z",
    // ~1.3 m/s walking pace, two legs around a couple of city blocks.
    legs: [
      { headingDeg: 90, speedMps: 1.3, intervalSec: 10, durationSec: 300 },
      { headingDeg: 0, speedMps: 1.3, intervalSec: 10, durationSec: 300 },
    ],
  },
  {
    file: "coastal-bike.gpx",
    name: "Coastal bike ride (sample)",
    startLat: 27.7676,
    startLon: -82.6403,
    startTime: "2026-01-15T09:00:00Z",
    // ~5 m/s (~11 mph) cycling pace along a gently curving coast road.
    legs: [
      { headingDeg: 135, speedMps: 5.0, intervalSec: 10, durationSec: 600 },
      { headingDeg: 170, speedMps: 5.0, intervalSec: 10, durationSec: 600 },
    ],
  },
  {
    file: "highway-drive.gpx",
    name: "Highway drive (sample)",
    startLat: 28.0500,
    startLon: -82.3000,
    startTime: "2026-01-15T18:00:00Z",
    // ~29 m/s (~65 mph) highway pace, mostly straight.
    legs: [{ headingDeg: 270, speedMps: 29.0, intervalSec: 5, durationSec: 1200 }],
  },
];

mkdirSync(WEB_PUBLIC_TRACKS_DIR, { recursive: true });

for (const track of tracks) {
  const points = buildTrack(track.startLat, track.startLon, track.startTime, track.legs);
  const gpx = toGpx(track.name, points);

  const outPath = join(__dirname, track.file);
  writeFileSync(outPath, gpx, "utf8");
  console.log(`wrote ${outPath} (${points.length} points)`);

  const webOutPath = join(WEB_PUBLIC_TRACKS_DIR, track.file);
  writeFileSync(webOutPath, gpx, "utf8");
  console.log(`wrote ${webOutPath} (${points.length} points)`);
}
