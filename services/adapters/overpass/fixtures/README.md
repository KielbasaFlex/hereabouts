# Fixtures — verification status

**Hand-authored from the documented Overpass QL/JSON shape, not recorded
from a live call.** This environment cannot reach `overpass-api.de`
(§16.1/SOURCES.md "Egress allowlist").

The response shape (`elements[]` with `type`/`id`/`lat`/`lon` for nodes,
`center: {lat, lon}` for ways/relations under `out center;`, and a flat
`tags` map) is standard, long-documented Overpass API JSON output.
Confidence is graded **High** in SOURCES.md for the *policy* half of this
source (public-instance fair-use limits); the query/response shape itself
is simple enough that I'd put it at the same confidence as Wikipedia's.

**Before this adapter is considered done**, from a machine that *can* reach
the public instance (dev/testing only — see the production note below):

```bash
curl -s -X POST --data-binary '[out:json][timeout:25];(node(around:1500,27.9506,-82.4572)[historic];way(around:1500,27.9506,-82.4572)[historic];);out center;' \
  https://overpass-api.de/api/interpreter
```

and confirm real elements come back with the tag names this adapter reads
(`historic`, `memorial`, `heritage`, `name`, `wikidata`, `wikipedia`).

## Production note

The public Overpass instance explicitly asks that applications not rely on
it as a backend (SOURCES.md §3, PLAN.md §16.3). `fetchNearbyPlaces` accepts
an `endpoint` override for exactly this reason — point it at a self-hosted
instance or regional extract before any real traffic. The default endpoint
here is fine for this dev/fixture-recording use only.

## Sample data is illustrative, not verified

The QID, tag values, and coordinates in `response.json` are hand-authored
placeholders for exercising the adapter's parsing (including the
`wikidata`/`wikipedia` tags that let `packages/core/dedup` link an OSM
element to a Wikidata/Wikipedia record for the same place) — not claims
about real OpenStreetMap data.
