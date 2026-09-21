# Fixtures — verification status

**Hand-authored, not recorded from a live call.** This environment's egress
proxy refuses `router.project-osrm.org` the same way it refuses
`en.wikipedia.org`/`query.wikidata.org`/`overpass-api.de` (confirmed with a
direct `curl` during Milestone 5 — 403 at CONNECT). Confidence here is
**high** regardless: OSRM's `/route/v1/{profile}/{coordinates}` response
shape (`code`, `routes[].geometry`/`distance`/`duration`, `waypoints`) has
been stable and publicly documented for years at
http://project-osrm.org/docs/v5.24.0/api/, unlike, say, the Wikidata
adapter's composed-SPARQL-query risk.

`route.json` is a small, explicitly-synthetic 4-point route (not a real
Tampa street routing result — the coordinates are illustrative) matching
the documented shape with `overview=full&geometries=geojson`, which is what
lets `fetchRoute` skip polyline decoding entirely and read `coordinates`
directly. `no-route.json` matches OSRM's documented `NoRoute` error shape,
used to test that `fetchRoute` throws with the server's own message rather
than returning an empty/fake route.

**Before this adapter is considered done**, from a machine that *can* reach
`router.project-osrm.org` (dev use only — see the module's own doc comment
on the demo server's rate limit): call `fetchRoute` for real between two
points a few hundred meters apart and confirm the returned `points` trace a
sane path and `distanceM`/`durationS` are plausible for that distance.

## Why Milestone 5 doesn't depend on this working today

The corridor-sampling → ingest → batch-generate → pack pipeline
(`packages/core/corridor`, `apps/api/src/route-pack.ts`) takes any
`Route`-shaped polyline — it doesn't care whether it came from a live OSRM
call or from parsing one of `tracks/*.gpx`'s sample tracks. `apps/api`'s
`/route-pack` endpoint supports both a `trackId` (no network needed, works
today) and an `origin`/`destination` pair (calls this adapter, unverified
live in this environment) specifically so the rest of the offline pipeline
can be built and verified for real without waiting on OSRM access.
