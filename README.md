# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 1: core loop.** Live geolocation, mode detection, a Wikipedia GeoSearch adapter, a
`/feed` API, and a web app that reads raw excerpts aloud with the browser's speech synthesis —
all wired together and driven end-to-end by the GPS simulator (see `tracks/`). See `PLAN.md`
§15 for the full milestone list.

**Known gap:** this development environment cannot reach `en.wikipedia.org` (see "A note on
network access" below), so the Wikipedia adapter is built and tested against hand-authored
fixtures, not a verified live response — see
`services/adapters/wikipedia/fixtures/README.md`. Everything else in the loop (position
tracking, mode classification, the API's privacy-rounding and distance recomputation, the
simulator, narration playback) has been exercised end-to-end with a real browser.

## Quickstart

```bash
corepack enable          # if pnpm isn't already available
pnpm install
pnpm test                # runs every package's test suite via Turborepo
pnpm typecheck
pnpm build
```

To regenerate the sample GPS tracks used by the simulator (writes to both `tracks/` and
`apps/web/public/tracks/`):

```bash
node tracks/generate.mjs
```

### Local Postgres + PostGIS (not yet used — needed from Milestone 2 onward)

```bash
docker compose up -d
```

This also starts Redis, used by the ingestion/generation job queue from Milestone 2 onward.

### Running the app

```bash
pnpm --filter @hereabouts/api dev    # API on :8787
pnpm --filter @hereabouts/web dev    # web app on :5173, proxies /api to the API
```

Open the web app, pick "Simulator" and a sample track (or "Live GPS" on a device with
location), and press Start. The status bar shows the live-detected travel mode and speed; a
text card appears — read aloud automatically — whenever `/feed` finds something nearby.

## Repo layout

```
packages/
  core/         # pure domain logic — geometry, mode detection, H3 cell rounding, GPX simulator. No I/O.
  contracts/    # shared zod schemas (PlaceEvent, /feed request & response)
services/
  adapters/
    wikipedia/  # GeoSearch + extracts adapter
apps/
  api/          # Hono server: POST /feed
  web/          # Vite + React app: live/simulated position, mode detection, narration
tracks/         # sample GPX tracks for the GPS simulator
```

See `PLAN.md` §3 for the full planned layout as later milestones (multi-source ingestion,
ranking, LLM storytelling, offline packs, billing) land.

## A note on network access

Several content sources (Wikipedia, Wikidata, Overpass, loc.gov) are not reachable from every
environment this project is developed in — see `SOURCES.md` → "Egress allowlist" for the exact
hosts needed, and `PLAN.md` §16.1 for the fallback plan. This blocks live verification of the
Wikipedia adapter specifically, but not the rest of Milestone 1 — the API gracefully returns a
502 rather than crashing when the upstream call fails, which is itself exercised by both the
adapter's and the API's test suites.
