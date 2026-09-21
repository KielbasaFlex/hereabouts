# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 3: storytelling.** On top of Milestone 2's multi-source `/feed`, a new `/story`
endpoint (`services/storytelling`) turns a selected place into a length-scaled, grounded
narration: Claude generates it with citations tied back to the source excerpt, three grounding
layers check it (deterministic numerals/entities/vagueness/spatial-language/n-gram-overlap/length
checks, then an LLM judge for unsupported claims and source-mirroring), a failed narration
regenerates once and then degrades to an extractive template card, and successful narrations are
cached by place/mode/prompt-version so repeat listeners don't re-pay for generation. See
`PLAN.md` §15 for the full milestone list and its Milestone 3 caveats section for exactly what's
simplified or unverified.

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

**What *has* been verified, live, against the real (blocked) network:** with all three live feed
sources correctly failing and being caught, `/feed` fell back to the local NRHP dataset and
returned real ranked results at **HTTP 200** — not a failure. At a location with nothing
anywhere, it degraded to an empty feed, still at 200. Separately, booting the API with a real
`new Anthropic()` client and calling `/story` showed the SDK's own client-side auth check reject
the request (no key configured), `buildStory` correctly treat that as a failed attempt, retry
once, and degrade to the grounded template fallback at **HTTP 200** rather than a 502 — the same
"never fail the request" design as `/feed`, now proven against the storytelling path's own real
failure mode. Both paths, plus the full narration UI (loading state, fallback note, citation
count), were also confirmed via a full browser (Playwright) driving the simulator against the
running web app.

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
                # clustering, ranking, spatial-frame classification, grounding validators,
                # GPX simulator. No I/O.
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
