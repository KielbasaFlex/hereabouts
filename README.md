# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones) and
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification). Both are living
documents, kept current as decisions are made.

## Status

**Milestone 0: scaffolding.** `packages/core` (geometry, mode detection, GPX simulator) exists
with tests; nothing that talks to the outside world does yet. See `PLAN.md` §15 for the full
milestone list.

## Quickstart

```bash
corepack enable          # if pnpm isn't already available
pnpm install
pnpm test                # runs every package's test suite via Turborepo
pnpm typecheck
pnpm build
```

To regenerate the sample GPS tracks used by the simulator (`tracks/*.gpx`):

```bash
node tracks/generate.mjs
```

### Local Postgres + PostGIS (needed from Milestone 1 onward)

```bash
docker compose up -d
```

This also starts Redis, used by the ingestion/generation job queue from Milestone 2 onward.

## Repo layout

```
packages/
  core/    # pure domain logic — geometry, mode detection, GPX simulator. No I/O.
apps/      # (Milestone 1+) API and web app
tracks/    # sample GPX tracks for the GPS simulator
```

See `PLAN.md` §3 for the full planned layout as later milestones land.

## A note on network access

Several content sources (Wikipedia, Wikidata, Overpass, loc.gov) are not yet reachable from
every environment this project is developed in — see `SOURCES.md` → "Egress allowlist" for the
exact hosts needed, and `PLAN.md` §16.1 for the fallback plan. This does not block Milestone 0,
which has no external dependencies.
