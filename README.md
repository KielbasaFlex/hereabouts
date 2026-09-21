# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 5: offline.** On top of Milestone 4's surface, the app can now build and play back a
fully offline route pack: `POST /route-pack` samples a route's corridor, ingests and dedupes
places along it from the same four sources `/feed` uses, batch-generates their stories via the
Anthropic Batches API, and computes the PMTiles tile list the corridor needs; `apps/web` downloads
a pack into IndexedDB and plays it back — text and speech, sequentially, in route order — with the
network fully disabled. See `PLAN.md` §15 for the full milestone list and its Milestone 5 caveats
section for exactly what's simplified or unverified.

**Known gaps (all explicitly flagged in `PLAN.md`/`SOURCES.md`, not silent):**

- This environment cannot reach `en.wikipedia.org`, `query.wikidata.org`, `overpass-api.de`, or
  `router.project-osrm.org` — all four live-network adapters are fixture-tested, not verified
  against a real response. See each adapter's `fixtures/README.md`. `/route-pack` accepts a
  `trackId` (one of `tracks/*.gpx`'s sample tracks) as a no-network alternative to a live
  OSRM origin/destination lookup, specifically so the rest of the offline pipeline is verifiable
  without it.
- NRHP has no real bulk dataset yet (can't reach the ArcGIS Hub download either, and there's no
  Postgres to load one into) — it runs against a small, explicitly-fictional placeholder
  dataset. See `services/adapters/nrhp/fixtures/README.md`.
- The gap filler is one practical tier (nearest named settlement), not the full
  neighbourhood → city → county → state cascade `PLAN.md` §7.6 sketches.
- **No `ANTHROPIC_API_KEY` in this environment**, so both live generation (`/story`) and batch
  pre-generation (`/route-pack`) are verified only via unit tests against injected fakes, plus a
  real-but-unauthenticated request proving each one's resilience path (see below) — never a real
  model response. `api.anthropic.com` itself is *not* network-blocked; see `SOURCES.md`'s
  Milestone 3 update.
- The shared story cache is in-memory only — no Postgres persistence yet, so it resets on every
  server restart, same as `/feed`'s lack of persistence in M1/M2.
- **Topic filters classify from text, not a real category field**, and **map tiles are unreachable
  from this environment** (OpenFreeMap, the MapLibre demo style, CARTO all blocked) — see the
  Milestone 4 section of `PLAN.md` for both.
- **No real PMTiles byte data is produced or served** — `packages/core/tiles` computes the real
  tile coordinates a corridor needs, but building/hosting the `.pmtiles` archive itself is a
  self-hosted data-pipeline step this codebase doesn't reimplement, the same posture `SOURCES.md`
  already takes for self-hosted OSRM.
- **No premium TTS / audio blobs** — offline playback uses the same free-tier Web Speech API as
  live playback (no network needed once the app shell is cached); pre-rendered audio needs
  Milestone 6's billing-gated TTS provider.
- **Batch pre-generation makes one attempt per place**, not the live path's regenerate-once — see
  `services/storytelling/src/batch.ts`'s own doc comment for why that's an accepted difference.
- **The trip log is client-local (`localStorage`) only** — there's no account system yet (M6) for
  a server-backed version to belong to, so it can't sync across devices.
- Citation highlighting in the text card is unit-tested but has never rendered a *real* citation
  live, since no real model response has been seen in this environment (same root cause as the
  `ANTHROPIC_API_KEY` gap above).
- **MVP acceptance criteria #1–#3 (§14) remain unautomated** — only #4 (route-pack offline
  playback) has a dedicated, repeatable check behind it from this build. See `PLAN.md`'s
  Milestone 5 caveats for exactly what that means.

**What *has* been verified, live, against the real (blocked) network:** with all three live feed
sources correctly failing and being caught, `/feed` fell back to the local NRHP dataset and
returned real ranked results at **HTTP 200** — not a failure. Booting the API with a real
`new Anthropic()` client and calling `/story` and `/route-pack` both showed the SDK's own
client-side auth check reject the request (no key configured), and both `buildStory` and
`generateStoriesViaBatch` correctly caught that and degraded to the grounded template fallback at
**HTTP 200** rather than a 502. **The Milestone 5 centerpiece:** downloaded a real route pack
through the running web app (real corridor sampling, real ingestion against the blocked sources,
real tile-coordinate computation, a real pack saved to IndexedDB), then used Playwright's
`context.setOffline(true)` — an actual network cut — to reload the page and confirm the service
worker served the cached app shell, the downloaded pack was still listed from a real offline
IndexedDB read, and "Play offline" correctly drove sequential playback through the pack's stories
in route order with **zero network requests**. That's PLAN.md §14's fourth MVP acceptance
criterion, executed against a real browser and a real offline network condition, not a mock.

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
otherwise. Below that, "Offline route packs" lets you download one of the sample tracks as a pack
and play it back fully offline (try it with your network actually disabled, once downloaded).

## Repo layout

```
packages/
  core/         # pure domain logic: geometry, mode detection, H3 cell rounding, dedup/
                # clustering, ranking, spatial-frame classification, grounding validators,
                # topic classification, corridor sampling, PMTiles tile-coordinate math,
                # GPX simulator. No I/O.
  contracts/    # shared zod schemas (PlaceEvent, /feed, Story, Route, RoutePack, ...)
services/
  adapters/
    wikipedia/  # GeoSearch + extracts, plus fetchArticleByTitle for the gap filler
    wikidata/   # SPARQL: nearby dated items, and nearest-settlement search
    overpass/   # historic=*/memorial=*/heritage=* OSM elements
    nrhp/       # local-dataset query (bulk download not yet wired — see its fixtures/README.md)
    osrm/       # driving-route polyline lookup (dev-only demo server — see its fixtures/README.md)
  storytelling/ # Claude generation + citations, 3-layer grounding, shared cache, Batch API
                # pre-generation, eval set
apps/
  api/          # Hono server: POST /feed, POST /story, POST /route-pack
  web/          # Vite + React app: live/simulated position, mode detection, narration, offline
                # route packs (IndexedDB + service worker)
tracks/         # sample GPX tracks for the GPS simulator and for track-based route packs
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

`api.anthropic.com` (used by `/story` and `/route-pack`) is a different case: it's reachable from
this environment, but no `ANTHROPIC_API_KEY` is configured, so the same "degrade, don't fail"
philosophy applies for a different reason — see `SOURCES.md`'s Milestone 3 update and
`services/storytelling/eval/README.md`.

`router.project-osrm.org` (used by `/route-pack`'s live routing path) is blocked the same way the
four content sources are — see `services/adapters/osrm/fixtures/README.md`. `/route-pack` also
accepts a `trackId` instead of an origin/destination pair specifically so the rest of the offline
pipeline can be exercised without it.
