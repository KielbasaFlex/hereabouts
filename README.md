# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 2: multi-source.** Four source adapters (Wikipedia, Wikidata, Overpass, NRHP) feed
a `/feed` endpoint that clusters the same real-world place across sources, ranks candidates by
ETA fit / ahead-ness / notability / topic affinity / novelty / source quality, and falls back to
a nearest-settlement gap filler when nothing point-level is nearby — so the app never goes
silent even when every live source is unreachable. See `PLAN.md` §15 for the full milestone list
and its Milestone 2 caveats section for exactly what's simplified or unverified.

**Known gaps (all explicitly flagged in `PLAN.md`/`SOURCES.md`, not silent):**

- This environment cannot reach `en.wikipedia.org`, `query.wikidata.org`, or
  `overpass-api.de` — all three live-network adapters are fixture-tested, not verified against
  a real response. See each adapter's `fixtures/README.md`.
- NRHP has no real bulk dataset yet (can't reach the ArcGIS Hub download either, and there's no
  Postgres to load one into) — it runs against a small, explicitly-fictional placeholder
  dataset. See `services/adapters/nrhp/fixtures/README.md`.
- The gap filler is one practical tier (nearest named settlement), not the full
  neighbourhood → city → county → state cascade `PLAN.md` §7.6 sketches.

**What *has* been verified, live, against the real (blocked) network:** with all three live
sources correctly failing and being caught, `/feed` fell back to the local NRHP dataset and
returned real ranked results at **HTTP 200** — not a failure. At a location with nothing
anywhere, it degraded to an empty feed, still at 200. Confirmed both via direct API calls and a
full browser (Playwright) driving the simulator against the running web app.

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

### Local Postgres + PostGIS (not yet used — no persistence layer through Milestone 2)

```bash
docker compose up -d
```

This also starts Redis, used by the ingestion/generation job queue from a later milestone.

### Running the app

```bash
pnpm --filter @hereabouts/api dev    # API on :8787
pnpm --filter @hereabouts/web dev    # web app on :5173, proxies /api to the API
```

Open the web app, pick "Simulator" and a sample track (or "Live GPS" on a device with
location), and press Start. The status bar shows the live-detected travel mode and speed; a
text card appears — read aloud automatically — whenever `/feed` finds something nearby, drawing
on whichever sources are reachable and falling back to the regional gap filler otherwise.

## Repo layout

```
packages/
  core/         # pure domain logic: geometry, mode detection, H3 cell rounding, dedup/
                # clustering, ranking, GPX simulator. No I/O.
  contracts/    # shared zod schemas (PlaceEvent, /feed request & response)
services/
  adapters/
    wikipedia/  # GeoSearch + extracts, plus fetchArticleByTitle for the gap filler
    wikidata/   # SPARQL: nearby dated items, and nearest-settlement search
    overpass/   # historic=*/memorial=*/heritage=* OSM elements
    nrhp/       # local-dataset query (bulk download not yet wired — see its fixtures/README.md)
apps/
  api/          # Hono server: POST /feed — fetch all sources, dedup, rank, gap-fill
  web/          # Vite + React app: live/simulated position, mode detection, narration
tracks/         # sample GPX tracks for the GPS simulator
```

See `PLAN.md` §3 for the full planned layout as later milestones (LLM storytelling, offline
packs, billing) land.

## A note on network access

Several content sources (Wikipedia, Wikidata, Overpass, loc.gov) are not reachable from every
environment this project is developed in — see `SOURCES.md` → "Egress allowlist" for the exact
hosts needed, and `PLAN.md` §16.1 for the fallback plan. This blocks live verification of three
of the four adapters, but not their behavior when unreachable: `/feed` is designed to degrade to
whatever sources *are* up (down to the local NRHP dataset, which needs no network at all) rather
than fail the request, and that resilience path is itself exercised by the test suites and by a
real server boot against this exact blocked network.
