# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 4: surface.** On top of Milestone 3's `/story` generation, the web app now has topic
filters (a real classifier, not a stub — see below), a MapLibre map view of the live/simulated
position and nearby candidates, citation highlighting in the text card's expandable source
excerpt, and a client-local trip log with JSON/GeoJSON export and a hard delete. See `PLAN.md`
§15 for the full milestone list and its Milestone 4 caveats section for exactly what's simplified
or unverified.

**Known gaps (all explicitly flagged in `PLAN.md`/`SOURCES.md`, not silent):**

- This environment cannot reach `en.wikipedia.org`, `query.wikidata.org`, or
  `overpass-api.de` — all three live-network adapters are fixture-tested, not verified against
  a real response. See each adapter's `fixtures/README.md`.
- NRHP has no real bulk dataset yet (can't reach the ArcGIS Hub download either, and there's no
  Postgres to load one into) — it runs against a small, explicitly-fictional placeholder
  dataset. See `services/adapters/nrhp/fixtures/README.md`.
- The gap filler is one practical tier (nearest named settlement), not the full
  neighbourhood → city → county → state cascade `PLAN.md` §7.6 sketches.
- **No `ANTHROPIC_API_KEY` in this environment**, so `services/storytelling` (generation, the
  grounding judge, and the eval set at `services/storytelling/eval/`) is verified only via unit
  tests against injected fakes, plus one real-but-unauthenticated request that proves the
  resilience path (see below) — never a real model response. `api.anthropic.com` itself is *not*
  network-blocked; see `SOURCES.md`'s Milestone 3 update.
- The shared story cache is in-memory only — no Postgres persistence yet, so it resets on every
  server restart, same as `/feed`'s lack of persistence in M1/M2.
- **Topic filters classify from text, not a real category field** — none of the four adapters
  fetch a live category/type API (that's another unverifiable live surface, same as the sources
  above), so `packages/core/src/topics` keyword-matches `title`/`summary` text instead. A ranking
  preference, never a hard filter, so a miss just doesn't boost a place rather than hiding it.
- **This environment's egress proxy also blocks every free map-tile host tried** (OpenFreeMap,
  the MapLibre demo style, CARTO) — the map view is verified live to degrade gracefully (an inline
  "tiles unavailable" note, no crash) rather than to actually render tiles. `VITE_MAP_STYLE_URL`
  swaps in a real style with no code change.
- **The trip log is client-local (`localStorage`) only** — there's no account system yet (M6) for
  a server-backed version to belong to, so it can't sync across devices.
- Citation highlighting in the text card is unit-tested but has never rendered a *real* citation
  live, since no real model response has been seen in this environment (same root cause as the
  `ANTHROPIC_API_KEY` gap above).

**What *has* been verified, live, against the real (blocked) network:** with all three live feed
sources correctly failing and being caught, `/feed` fell back to the local NRHP dataset and
returned real ranked results at **HTTP 200** — not a failure. At a location with nothing
anywhere, it degraded to an empty feed, still at 200. Booting the API with a real
`new Anthropic()` client and calling `/story` showed the SDK's own client-side auth check reject
the request (no key configured), `buildStory` correctly treat that as a failed attempt, retry
once, and degrade to the grounded template fallback at **HTTP 200** rather than a 502. A full
browser (Playwright) driving the simulator against the running web app confirmed: selecting topic
filter chips actually changes the `topics` array in the live `/feed` request payload; the map
initializes, hits the same blocked-network wall, and shows its fallback note without crashing the
rest of the page; and enabling the trip log, hearing two places, and exporting JSON produced a
real browser download with the correct recorded entries.

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
export ANTHROPIC_API_KEY=sk-ant-...  # optional — without it, /story degrades to the
                                      # template fallback for every request (see Status above)
export VITE_MAP_STYLE_URL=...        # optional — overrides the map's default (dev-only) style;
                                      # see SOURCES.md's Milestone 4 update
pnpm --filter @hereabouts/api dev    # API on :8787
pnpm --filter @hereabouts/web dev    # web app on :5173, proxies /api to the API
```

Open the web app, pick "Simulator" and a sample track (or "Live GPS" on a device with
location), optionally select topic filters or turn on the trip log, and press Start. The status
bar shows the live-detected travel mode and speed; a map shows your position and nearby
candidates; a text card appears — read aloud automatically — whenever `/feed` finds something
nearby, drawing on whichever sources are reachable and falling back to the regional gap filler
otherwise.

## Repo layout

```
packages/
  core/         # pure domain logic: geometry, mode detection, H3 cell rounding, dedup/
                # clustering, ranking, spatial-frame classification, grounding validators,
                # topic classification, GPX simulator. No I/O.
  contracts/    # shared zod schemas (PlaceEvent, /feed request & response, Story, StoryRequest)
services/
  adapters/
    wikipedia/  # GeoSearch + extracts, plus fetchArticleByTitle for the gap filler
    wikidata/   # SPARQL: nearby dated items, and nearest-settlement search
    overpass/   # historic=*/memorial=*/heritage=* OSM elements
    nrhp/       # local-dataset query (bulk download not yet wired — see its fixtures/README.md)
  storytelling/ # Claude generation + citations, 3-layer grounding, shared cache, eval set
apps/
  api/          # Hono server: POST /feed, POST /story
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

`api.anthropic.com` (used by `/story`) is a different case: it's reachable from this
environment, but no `ANTHROPIC_API_KEY` is configured, so the same "degrade, don't fail"
philosophy applies for a different reason — see `SOURCES.md`'s Milestone 3 update and
`services/storytelling/eval/README.md`.
