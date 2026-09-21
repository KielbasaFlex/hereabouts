# Content Sources — API, Limits, Terms, Attribution

Per the brief: every source is confirmed for current API, rate limits, terms of service, and
attribution/licence requirements before integration, and any source whose terms don't permit
this use is excluded.

## Verification status — read this first

**No source in this document has been verified by a live API call.** This build container's
egress proxy refuses all five content-source hosts with a 403 at CONNECT (see `PLAN.md`
§16.1), and the proxy documentation states such denials are organisation policy and must be
reported rather than routed around — so I didn't.

Everything below is therefore verified **from current published documentation**, not from
responses. Confidence is graded per source, and each carries an explicit live-check list that
must pass before that adapter is considered done.

| Confidence | Meaning |
|---|---|
| **High** | Stable, long-documented API; low chance the shape has moved |
| **Medium** | Documented but recently changed, or limits are informal/unpublished |
| **Low** | Known recent migration or reported access friction; treat as unproven |

## Egress allowlist (for this environment)

Five hosts, all plain HTTPS/443, would unblock live verification and fixture recording for
every adapter in this document. This is a **development-time** allowlist — production traffic
for Overpass and OSRM must go through self-hosted infrastructure regardless (§16.3 in
`PLAN.md`), so allowlisting here doesn't change that production plan.

| Host | Needed for |
|---|---|
| `en.wikipedia.org` | GeoSearch + extracts (§1) — the M1 exit criterion |
| `query.wikidata.org` | WDQS SPARQL endpoint (§2) |
| `overpass-api.de` | Overpass API, dev instance only (§3) |
| `www.loc.gov` | loc.gov JSON API / Chronicling America, deferred to M4+ (§4) |
| `public-nps.opendata.arcgis.com` | NRHP bulk spatial dataset download (§5) — one-off, not a runtime dependency |

Not requested: `overpass-api.de` and the OSRM demo server are single-purpose dev/fixture
endpoints by design (their own usage policies forbid production reliance — §7), so nothing
else needs to be added once self-hosted routing/Overpass are stood up later.

If allowlisting isn't possible in this environment, the fallback in `PLAN.md` §16.1 (local
Claude Code, or fixture-first development with locally-recorded fixtures committed back) still
applies — M0 needs none of these hosts and isn't waiting on this.

---

## 1. Wikipedia — GeoSearch + Extracts

- **Status**: planned, Milestone 1 (primary source)
- **Confidence**: **High**
- **Endpoint**: `https://en.wikipedia.org/w/api.php` — `action=query&list=geosearch`
- **Key params**: `gscoord` (lat|lon), `gsradius` (**10–10000 m**, hard max 10 km),
  `gslimit` (max **500**; 5000 for bots), `gsprop`, `gsprimary`
- **Extracts**: `action=query&prop=extracts&exintro&explaintext` (batched by `pageids`)

**Limits**: Wikimedia enforces per-IP limits for anonymous clients and substantially higher
limits for OAuth-authenticated clients. A **compliant `User-Agent` is not optional** — a
generic or absent UA drops the client into a restrictive anti-scraping tier or gets it blocked
outright. Required format includes an app name and contact:

```
Hereabouts/0.1 (https://hereabouts.app; contact@hereabouts.app)
```

**Licence**: CC BY-SA 4.0. Attribution: article title + link + "Wikipedia, CC BY-SA 4.0".

> **Facts-only posture — see `PLAN.md` §16.2.** Narration draws facts from this excerpt but is
> generated and validated (n-gram overlap check) to avoid mirroring its phrasing, so it doesn't
> rely on being a BY-SA derivative. Attribution ships on every card regardless.

**Design rules**: single shared UA constant; per-source token bucket well under the anonymous
ceiling; cache by H3 cell (§4.3) so repeat users in an area cost zero upstream calls; add
OAuth if volume ever approaches the anonymous tier.

**Live checks before M1 is done**: geosearch returns expected shape; radius >10000 is rejected as documented; a batched extracts call succeeds; UA is present on every request.

---

## 2. Wikidata — SPARQL (WDQS)

- **Status**: **implemented** (`services/adapters/wikidata`), fixture-tested only — see the
  live-checks note below, which is stronger than usual for this source
- **Confidence**: **Medium** — endpoint stable, but performance and the 2025 graph split matter
- **Endpoint**: `https://query.wikidata.org/sparql` (`format=json`)
- **Use, as shipped**: items with coordinates (`P625`) plus an **inception date (`P571`) only**.
  `P576` (dissolved), `P585` (point in time), and `P793` (significant event) are documented
  candidates for a follow-up, not yet queried — scoped down to one property to keep the first
  version's SPARQL simple enough to have a real chance of being correct unverified. Also powers
  a second query, nearest-settlement search (Q486972 human-settlement subclasses) for the
  Milestone 2 gap filler's regional framing — see `PLAN.md` §7.6 and this adapter's own
  fixtures/README.md for why that's nearest-search, not true containment.

**Limits**: ~60 s of query time per minute per (IP + User-Agent), bursting to ~120 s; ~30
errors/min. Hard 60 s per-query timeout. Reports through 2026 describe the public endpoint as
materially slower than historically.

**Licence**: **CC0** — no attribution obligation. We credit it anyway.

**Design rules**: **never in the request path.** Batch enrichment worker only, tight
`LIMIT`s, bbox-constrained queries, aggressive caching, silent degradation on timeout.
Self-hosted WDQS or Wikidata dumps if it becomes load-bearing.

**Live checks — elevated importance for this source**: unlike a REST API, a SPARQL query can be
syntactically well-formed from documented clauses and still not do what's intended. Every clause
used here (`SERVICE wikibase:around`, `geof:distance`, the `psv:`/`wikibase:timeValue`/
`wikibase:timePrecision` path for statement qualifiers, `schema:about`/`schema:isPartOf` for
sitelinks) is a standard, documented pattern individually — the *composed* query has never run
against the real endpoint. Paste both query builders' output into
https://query.wikidata.org/ before trusting this adapter with real traffic; representative bbox
query returns inside 60 s; timeout path degrades silently; UA attributed correctly.

---

## 3. OpenStreetMap — Overpass API

- **Status**: **implemented** (`services/adapters/overpass`), fixture-tested only (§16.1)
- **Confidence**: **High** on policy, **Medium** on specific public-instance quotas (per-instance and informal)
- **Endpoint**: `https://overpass-api.de/api/interpreter` (dev only — the adapter takes an
  `endpoint` override for production self-hosting); `/api/status` reports remaining quota
- **Query, as shipped**: `historic=*`, `memorial=*`, `heritage=*` within an `around:` radius
  (not yet `historic:civilization=*`, and not yet the bbox form — `around` was simpler to
  compose correctly for a point-radius query, which is what every caller actually has)

**Limits and policy — the decisive point**: public Overpass instances explicitly discourage
applications that rely on them as a backend, and direct heavy users to planet dumps or their
own instance. Per-IP slot quotas, ~12 GiB memory ceiling, load shedding under pressure.

> **Consequence**: the public instance is a **development-only** dependency. Self-hosting
> Overpass (or preprocessing regional extracts into our own PostGIS) is a prerequisite for
> production traffic, not an optimisation. Budgeted in `PLAN.md` §16.3.

**Licence**: **ODbL 1.0**. Attribution "© OpenStreetMap contributors" on every surface using it.

> **ODbL note**: rendered narration is a *Produced Work* (attribution suffices). Our ingested
> table is a *Derivative Database* — share-alike would bite only if we publicly distribute the
> database itself, which we don't. Route packs ship produced works plus attribution, not raw extracts.

**Live checks**: `/api/status` parses; the `around`-based query returns expected elements with
the tag names this adapter reads; 429/504 backoff verified.

---

## 4. Library of Congress — loc.gov JSON API (incl. Chronicling America)

- **Status**: deferred to Milestone 4+
- **Confidence**: **Low** — recent migration plus reported access friction

**Recent change that invalidates older integration guides**: the legacy
`chroniclingamerica.loc.gov` API was retired in **August 2025**. The collection is now reached
**exclusively through the loc.gov API**; the old hostname permanently redirects. Any code or
tutorial predating this is wrong.

- **Endpoint**: `https://www.loc.gov/collections/chronicling-america/?q=...&fo=json`
- **Auth**: none required
- **Limits**: ~20 requests/min for JSON endpoints; ~150/min for image/storage; LoC's own legal
  guidance suggests staying under ~10 requests/min site-wide. Rate limiting is "strongly encouraged" of clients.

**Known problem**: the JSON API has been reported to return a **Cloudflare challenge to
programmatic clients**, sometimes on the first request of a session, despite being documented
as public and key-free. This is the single largest unknown in the source set and the reason
this source is deferred rather than shipped in M2.

**Licence**: primarily **public domain (US Government / pre-1929 newspapers)** — but rights
vary per item and must be checked per record, not assumed collection-wide.

**Design rules**: batch-only ingest, never in the request path; conservative ≤10 req/min;
per-item rights capture; **the adapter must be droppable** — if the Cloudflare behaviour proves
persistent, we ship without it rather than build fragile evasion (which would also be poor practice against a public institution).

**Live checks**: does a plain JSON request succeed from a server IP? Does it survive repeated
calls? Is location matchable well enough to be worth the complexity? A "no" to the first two ends this source.

---

## 5. National Register of Historic Places (NPS)

- **Status**: **adapter interface implemented** (`services/adapters/nrhp`), but running against
  a small, explicitly-fictional **placeholder dataset**, not the real bulk download — this
  environment can't reach `public-nps.opendata.arcgis.com` either (§16.1), and there's still no
  Postgres to load a real bulk dataset into. `queryNearby`'s spatial-filter/normalise logic is
  real and tested; the data it's tested against is not.
- **Confidence**: **Medium** — data is definitely available; exact access path to confirm
- **Access**: two routes —
  1. **Bulk spatial download** (preferred): NRHP public dataset via NPS open data / ArcGIS Hub
     and the IRMA portal — point + polygon geodatabase, loaded straight into PostGIS.
  2. NPS developer API (`developer.nps.gov`, free key) — park-centric, **not** a full NRHP index.

> Route 1 is the right one: NRHP is a slow-changing national inventory. A periodic bulk load
> into our own PostGIS gives zero per-request upstream dependency, no rate limit, and the best
> latency of any source. Refresh quarterly.

**Coverage caveat**: restricted/sensitive records (notably archaeological sites) are
**deliberately excluded** from the public dataset. Expected and correct — we must not treat
absence as a data bug, and must never attempt to reconstruct withheld locations.

**Licence**: **US Government public domain**. No attribution obligation; we credit NPS anyway.

**Live checks**: current download URL and format; record count; coordinate quality; that the
listing-significance field can drive `notability`; and — new since the adapter interface now
exists — the real field-name mapping into this adapter's `NrhpRecord` shape (`refNumber`,
`name`, `lat`, `lon`, `listedYear`, `significance`), which hasn't been written yet because this
build has never seen the real dataset's actual schema. See
`services/adapters/nrhp/fixtures/README.md`.

---

## 6. Historical Marker Database (HMdb) — **EXCLUDED**

- **Status**: **excluded from V1**
- **Reason**: HMdb's API appears to be available only under a **signed licence agreement** with
  the publisher; the public terms do not grant general API or bulk data reuse. Third-party apps
  using it describe operating under such an agreement.

Under the brief's rule — *"exclude any source whose terms don't permit this use"* — this is an
exclusion, not a risk to manage. Scraping the site instead is not an option we'll pursue.

**Path to inclusion**: approach the publisher for a licence. The adapter interface (`PLAN.md`
§6) means adding it later is one module plus a licence row, so nothing about excluding it now
is hard to reverse. Historical-marker text is a great fit for this product, so this is worth
doing if you want to pursue it.

---

## 7. Supporting services (not content sources)

### Routing — OSRM / OpenRouteService
The OSRM **demo server is explicitly restricted to reasonable non-commercial use, capped at
~1 request/second, with no uptime guarantee and withdrawal possible at any time**. Its policy
specifically calls out apps whose users call it every few seconds as unacceptable — which is
our exact shape. **Self-host OSRM for production**; demo server for development only.
Attribution required: ODbL for the data, OSRM for the routes. OpenRouteService is the
alternative (free API tier with published daily quotas, key required).

### Map tiles — Protomaps PMTiles (self-hosted)
OSM's own tile servers **forbid production use and explicitly forbid bulk prefetch for offline
use** — which would rule out V1's route pre-download outright. Self-hosted **PMTiles** from our
own object storage is the only option where offline corridor slices are unambiguously
permitted, with near-zero marginal cost. Hosted alternatives (MapTiler, Stadia — free tier
~200k tiles/month non-commercial) remain viable for *online* use with plan-dependent offline
rights. Attribution "© OpenStreetMap contributors" regardless.

### LLM — Claude API
`claude-opus-5`. Server-side key only, per the brief's no-client-secrets rule. Cost model,
prompt caching and Batch API strategy in `PLAN.md` §8.4.

### TTS — premium voices
Server-side provider (OpenAI or ElevenLabs), key server-side only. **Check the chosen
provider's terms for cached/stored output and commercial redistribution rights before M6** —
our whole cost model depends on persisting generated audio in object storage and serving it to
many users, which is a licence question, not just a technical one. Recorded here so it isn't
missed.

---

## Attribution surfaces (implementation checklist)

Every story card renders the licence and source link for its record. Additionally:

- **In-app `/attribution` page**: Wikipedia (CC BY-SA 4.0), Wikidata (CC0), OSM (ODbL),
  NPS/LoC (public domain), OSRM/routing, tiles.
- **Route packs** ship an attribution manifest so offline playback carries credit too.
- **Per-record `license` column** (`PLAN.md` §4.1) so attribution is data-driven and a
  licensing-posture change is a policy change, not a migration.
