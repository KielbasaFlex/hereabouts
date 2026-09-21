# Hereabouts — Architecture & Build Plan

**Status: awaiting approval. No application code has been written yet.**

This document is the deliverable for the pre-code gate: stack choice with rationale, data
model, core-loop algorithms, milestones, and open risks. Source-by-source API/licence
verification lives in [`SOURCES.md`](./SOURCES.md).

Two things I need you to read before anything else:

1. **This build container cannot reach any of the content-source APIs.** See
   [§16.1](#161-blocking-the-dev-container-cannot-reach-the-content-sources) — this blocks
   Milestone 1 acceptance and needs an environment decision from you, not a code change.
2. **CC BY-SA ShareAlike probably reaches the generated narration.** See
   [§16.2](#162-licensing-cc-by-sa-sharealike-may-attach-to-our-narration) — this is a
   product-shaping question, cheapest to answer now.

---

## 1. What we're building, restated as an engineering problem

A continuous scheduler. The user moves along a path; we must have a grounded, spoken story
*queued and starting* before they reach the thing it's about, and we must never go quiet for
more than ~15 seconds. Everything else — sources, LLM, TTS, billing — is in service of that
scheduler.

Framing consequence that shapes the whole design: **this is an ETA problem, not a radius
problem.** "What is within 2km of me" is the wrong query. The right query is "what will I
arrive at in 40–120 seconds, given my heading and speed, that I haven't heard yet." Distance
is an input to that, not the answer. §7 builds on this.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict, everywhere | Mandated; one language across core/web/API/native |
| Monorepo | pnpm workspaces + Turborepo | Cheap, standard, good task graph caching |
| Shared core | `packages/core` — **zero I/O, zero platform deps** | The native-readiness bet. See §2.1 |
| Web app | Vite + React 19 + TypeScript, PWA via `vite-plugin-pwa` (Workbox) | See §2.2 — this is the load-bearing choice |
| API | Hono on Node 22, `@hono/zod-openapi` | Typed RPC client shared with web via the monorepo; portable runtime; OpenAPI for the future native client |
| DB | Postgres 17 + PostGIS 3.5 | Mandated/equivalent. `geography` types, GIST indexes, `ST_DWithin` |
| Cache/queue | Redis + BullMQ | Prefetch jobs, TTS jobs, route-pack builds, rate limiting |
| Object storage | S3-compatible (R2) | Generated audio blobs, route packs |
| Map | MapLibre GL JS + **Protomaps PMTiles** | See §2.3 — the only option that legally survives offline |
| Auth | Auth.js (email + OAuth) | Standard, self-hosted, no vendor lock |
| Billing | Stripe Billing + Customer Portal | Mandated |
| LLM | Claude API — `claude-sonnet-5` narration (default), `claude-haiku-4-5-20251001` grounding judge | See §8.4 for model/cost reasoning; `claude-opus-5` is the eval-gated fallback |
| Tests | Vitest + Playwright | Fast unit core; Playwright for the PWA loop |

### 2.1 Why a pure, I/O-free `packages/core`

`packages/core` contains mode detection, geo math, ahead-ness, ranking, dedup, the queue
state machine, and the grounding validator. It imports nothing platform-specific — no `fetch`,
no `navigator`, no `pg`. Position arrives through a `PositionSource` interface and time
through a `Clock` interface.

This buys three things at once, which is why it's the first decision:

- **Native later is a shell swap, not a rewrite.** Capacitor/Expo supplies a different
  `PositionSource` (background geolocation) and a different audio sink. The scheduler is byte-identical.
- **The GPS simulator is not a test harness bolted on the side** — it's just another
  `PositionSource` + a virtual `Clock`. Same code path as production, which is the only way a
  simulator is trustworthy.
- **The acceptance criteria become unit tests.** "No silence > 15s" is a pure function of
  (track, clock, queue state). No browser, no network, runs in milliseconds in CI.

### 2.2 Why Vite SPA, not Next.js

Next.js is the reflexive choice and it's wrong here. Capacitor wraps a static bundle; an SSR
Next app has to be coerced into `output: export`, at which point its main features are gone.
Every screen in this product is behind geolocation permission and is user-specific, so SSR and
SEO buy us nothing. A Vite SPA + a separate Hono API means the future native app is a
first-class client of the same API rather than a second-class scraper of a web app. The cost
is a marketing/SEO site we'd need separately, which is a ~1-day static site later.

### 2.3 Map tiles: the offline requirement decides this

OSM's own tile servers forbid production use *and* explicitly forbid bulk prefetch for offline
use — which is exactly V1 feature #1. Hosted providers (MapTiler, Stadia) permit production
traffic but offline caching is plan-dependent and metered. **Protomaps PMTiles** — a single
archive file served from our own object storage with HTTP range requests — is the only option
where "download this route corridor for offline use" is unambiguously permitted, because we're
serving our own build of open data. It also makes the route pack trivial: slice a PMTiles
corridor into the pack. MapTiler stays as the online fallback style if PMTiles rendering
quality disappoints.

---

## 3. Repo layout

```
packages/
  core/          # pure domain logic — no I/O. The native-portable heart.
    geo/         # haversine, bearing, along-track distance, closest approach, ETA
    mode/        # speed smoothing + hysteresis mode classifier
    rank/        # scoring, ahead-ness, novelty, topic affinity
    queue/       # story queue state machine, invalidation
    grounding/   # deterministic narration validators
    sim/         # GPX parser, virtual clock, track replay
  contracts/     # zod schemas + shared types (API request/response, PlaceEvent, Story)
  db/            # drizzle schema + migrations + PostGIS helpers
apps/
  api/           # Hono: /feed, /story, /tts, /route-pack, /trip, /billing, /me
  web/           # Vite + React PWA
  worker/        # BullMQ consumers: ingest, generate, validate, tts, route-pack
services/
  adapters/      # one module per content source, behind a common interface
tracks/          # sample GPX: downtown walk, coastal bike, highway drive
```

---

## 4. Data model

PostGIS `geography(Point, 4326)` throughout (metres, correct across the antimeridian).

### 4.1 `place_event` — the normalised record

The common record all adapters emit.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `source` | enum | `wikipedia`, `wikidata`, `osm`, `loc`, `nrhp` |
| `source_id` | text | natural key within the source |
| `title` | text | |
| `geom` | geography(Point,4326) | GIST index |
| `date_start`, `date_end` | int (year, nullable) | |
| `date_precision` | enum | `exact`, `year`, `decade`, `century`, `unknown` — drives how vague the narration is allowed to be |
| `era_text` | text | verbatim source phrasing, e.g. "the early 1900s" |
| `summary` | text | |
| `source_excerpt` | text | **the grounding substrate.** Nothing may be narrated that isn't here |
| `source_url` | text | |
| `license` | enum | `cc-by-sa-4.0`, `cc0`, `odbl`, `public-domain-usgov` |
| `topics` | text[] | GIN index |
| `notability` | numeric | normalised 0–1, see §7.4 |
| `raw` | jsonb | original payload, for reprocessing without refetch |
| `fetched_at`, `expires_at` | timestamptz | |
| `dedupe_key` | text | see §4.2 |

Unique on `(source, source_id)`.

### 4.2 Cross-source dedup

The same courthouse is a Wikipedia article, a Wikidata item, an OSM `historic=*` node and an
NRHP listing. Narrating it four times is the most likely way this product feels broken.

Resolution order: (1) explicit identity links — Wikidata `P1435`/`P649` to NRHP, OSM
`wikidata=*`/`wikipedia=*` tags; (2) fuzzy fallback — within 75 m **and** trigram title
similarity > 0.55. Matches collapse into a `place_cluster` with a preferred record chosen by
source quality, and the others retained as supporting excerpts (more grounding material, one
story). `dedupe_key` is the cluster id.

### 4.3 `coverage_cell` — fetch bookkeeping and the privacy boundary

`(h3_index res 7, source) -> last_fetched_at, record_count, etag`.

H3 res 7 is ~1.2 km edge. It does double duty: it stops us re-hitting Overpass for an area we
pulled 20 minutes ago, **and** it is the rounding unit for §13 — third-party source queries are
issued for a cell centroid, never the user's true coordinates.

### 4.4 `story` — the shared global cache

The main cost control, designed in from day one per the brief.

Key: `(cluster_id, length_bucket, prompt_version)` — **not** per user, not per voice.
Columns: `narration`, `claims jsonb` (cited spans, §8.3), `validation_status`, `model`,
`input_tokens`, `output_tokens`, `created_at`.

`prompt_version` in the key means a prompt change is a new cache generation with a clean
rollback, not an unversioned mass invalidation.

Voice is deliberately *not* in this key. Text and audio have different cardinality and
different costs, so they get different tables:

### 4.5 `story_audio`

`(story_id, voice_id, provider) -> object_key, duration_ms, bytes, created_at`.

`duration_ms` is not bookkeeping — the scheduler in §7.5 needs the real duration to decide
whether a story still fits before the user arrives.

### 4.6 Regions, users, trips

- `region` — admin polygons (city/county/state) with `wikidata_qid`, for the gap filler.
  `geography(MultiPolygon)`, GIST. `region_story` mirrors §4.4 keyed by `(region_id, level, length_bucket, prompt_version)`.
- `user`, `account`, `session` — Auth.js.
- `subscription` — Stripe mirror: `stripe_customer_id`, `status`, `tier`, `current_period_end`.
- `tier_limit` — **rows, not constants** (brief requires configurable limits): `tier`,
  `daily_story_cap`, `premium_voices bool`, `route_packs bool`, `trip_log bool`.
- `usage_event` — append-only meter: `user_id`, `kind` (`story_generated`, `story_served`,
  `tts_seconds`), `cost_micros`, `created_at`.
- `trip` / `trip_event` — **only written when the user opts in** (§13). `trip_event` holds
  `story_id`, `heard_at`, and position only if trip-log consent is on.
- `saved_place`, `route_pack`.

---

## 5. Request path

```
Client (every ~2s, batched):  POST /feed  { h3_cell, heading, speed, mode, heard_ids[], topics[] }
                                   |
                              Hono API
                                   |
      +----------------------------+----------------------------+
      |                            |                            |
 PostGIS candidate query    Redis: coverage check       Story cache lookup
      |                            |                            |
      |                     miss -> enqueue ingest       miss -> enqueue generate
      |                            |                            |
      +----------------------------+----------------------------+
                                   |
                        rank + schedule (packages/core)
                                   |
                     response: ordered queue of ready stories
                                  + text cards + attribution
```

The client sends an **H3 cell, not a coordinate** (§13). Ingestion and generation are always
async via BullMQ — the request path never blocks on Overpass or on Claude. If nothing is
ready, the gap filler (§7.6) answers from the regional deck, which is pre-warmed.

---

## 6. Source adapters

Common interface, one module each, all returning `PlaceEvent[]`:

```ts
interface SourceAdapter {
  id: SourceId;
  fetchArea(cell: H3Index, opts: FetchOpts): Promise<PlaceEvent[]>;
  license: LicenseId;
  attribution: AttributionSpec;
}
```

Per-source status, limits, licences and verification state: **[`SOURCES.md`](./SOURCES.md)**.
Summary of what ships when:

- **M1**: Wikipedia GeoSearch + extracts.
- **M2**: Wikidata SPARQL, OSM/Overpass, NRHP.
- **M4+**: Library of Congress / Chronicling America (lowest confidence — see `SOURCES.md`).
- **Excluded**: HMdb — its API appears to require a signed licence agreement, which fails the
  brief's "exclude any source whose terms don't permit this use" test until such an agreement exists.

---

## 7. The core loop

### 7.1 Mode detection

EWMA-smoothed speed (α≈0.3) over GPS samples, discarding fixes with `accuracy > 50 m`, plus
**hysteresis with dwell**, because the brief is right that naive thresholds flicker:

| To | Enter | Dwell | Exit |
|---|---|---|---|
| stationary | < 0.4 m/s | 15 s | > 0.7 m/s |
| walking | 0.4–2.2 m/s | 10 s | — |
| biking | 2.2–7.0 m/s | 15 s | < 1.8 / > 8.0 m/s |
| driving | > 7.0 m/s | 20 s | < 6.0 m/s for 30 s |

Overlapping enter/exit bands are the hysteresis. A bike stopped at a light does not become a
pedestrian. Unit-tested against synthetic traces including a traffic-jam trace (driving at
walking speed) which must *stay* in driving mode.

### 7.2 Geometry

In `packages/core/geo`, pure functions, property-tested:
`haversine`, `bearing`, `crossTrackDistance`, `alongTrackDistance`, `closestApproach(pos, heading, target)`, `etaSeconds`.

### 7.3 Ahead-ness

Not a boolean. `aheadness ∈ [-1, 1]` = `cos(bearingToTarget - heading)`, gated by a
mode-dependent cone and modulated by cross-track distance:

| Mode | Look-ahead radius | Cone half-angle | Rationale |
|---|---|---|---|
| walking | 400 m | 180° (omni) | pedestrians turn freely; "nearby" is honest |
| biking | 1.5 km | 90° | committed to a road, can still turn |
| driving | 5 km | 60° | committed; needs the longest lead time |

### 7.4 Ranking

```
score = w_eta * etaFit           // peaks in the 40–120s arrival window
      + w_ahead * aheadness
      + w_note * notability
      + w_topic * topicAffinity  // ranking weight, never a hard filter (per brief)
      + w_novel * novelty        // 0 if heard this trip; decayed if heard recently
      + w_src * sourceQuality
```

Weights are a config object, per-mode, tunable without a deploy. `notability` is normalised
per-source and blended: Wikipedia — incoming links + article length + pageviews; Wikidata —
sitelink count; OSM — tag richness/heritage level; NRHP — listing significance level.

Topic filters affect weight only, as the brief specifies — a filtered-out topic still beats
silence, it just loses to everything else.

### 7.5 The queue — where "before, not after" is enforced

Target 2–3 prepared stories, ~90 s of audio queued.

Admission rule, using the real `duration_ms` from §4.5:

> Admit story *s* for place *p* only if `eta(p) - duration(s) > 5s` — the narration must
> **finish** before arrival, not start at it.

That single inequality is what makes the product feel like a guide rather than a lagging
podcast, and it's why §4.5 stores duration.

Invalidation on every position update: drop queued stories whose place is now behind us
(`aheadness < -0.3`), whose cross-track distance exceeded the mode radius (user turned off),
or whose ETA collapsed below their duration (user sped up). Dropped stories return to the
candidate pool rather than the heard set — a missed turn shouldn't permanently burn a story.

### 7.6 Gap filler

Cascade, widening until something is found, with **honest framing per level** (this framing is
part of the grounding contract, not a copy detail):

| Level | Opener |
|---|---|
| place (< radius) | "Right about where you are…" |
| neighbourhood | "Just around here…" |
| city | "This part of {city}…" |
| county | "Around this part of {county}…" |
| state/region | "Across this whole region…" |

The regional deck for the containing admin areas is pre-warmed on trip start and kept
topped-up in the background, so the gap filler is always a cache hit. This is the mechanism
that delivers "no silence > 15 s" — silence is a cache-miss bug, and the deck is how we never miss.

---

## 8. Storytelling

### 8.1 Model and parameters

**Default: `claude-sonnet-5`**, via the Anthropic TypeScript SDK. Adaptive thinking
(`thinking: { type: "adaptive" }`), `output_config: { effort: "low" }` — short grounded
rewriting is not a reasoning-heavy task, and effort is the first quality/cost lever we tune
with measurement (§8.4) rather than guesswork. This is a per-call parameter, not an
architectural commitment: the story cache key (§4.4) includes `model`, so nothing about
switching a length bucket to a different model later is a migration.

`claude-opus-5` is kept as the **eval-gated ceiling model** — used only where the M3 eval
(§8.4) shows Sonnet failing the quality bar for a specific topic or length bucket, not as a
manual escape hatch.

### 8.2 Length scaling

| Mode | Target | Words |
|---|---|---|
| driving | 20–40 s | 60–100 |
| biking | 45–75 s | 120–200 |
| walking | 90–120 s | 250–300 |

Enforced as a deterministic post-check, not a hope: out-of-band word counts fail validation
and regenerate once.

### 8.3 Grounding — the part that must not be hand-waved

Three layers, cheap-first. A story that fails any layer is never served.

**Layer 1 — generate with citations.** The source excerpt goes in as a `document` content
block with `citations: { enabled: true }`. The response comes back as text blocks carrying
`cited_text` and character offsets into our own excerpt. This is a structural advantage over
"generate then check": the model returns *where each claim came from*, so traceability is a
property of the generation rather than a reconstruction after the fact. It also directly
satisfies the acceptance criterion "every narrated fact can be traced to a cited source
excerpt shown on the card" — the card renders the citation spans we already have.

*Constraint recorded:* citations and `output_config.format` are mutually exclusive (the API
rejects the combination), so the narration pipeline uses citations and gets its structure from
the citation blocks, **not** from structured output. The validator and topic-tagging jobs,
which need strict JSON and no citations, use structured outputs in separate calls.

**Layer 2 — deterministic validators** (pure functions in `packages/core/grounding`, the
cheapest and most reliable layer):

- *Numeral/date check*: every year, count and measurement in the narration must appear in a
  cited span. Catches the classic invented-date failure.
- *Entity check*: capitalised multi-word spans must appear in a cited span, modulo a stoplist.
- *Vagueness preservation*: if `date_precision` is `decade`, a bare specific year in the
  narration is a failure. This enforces the brief's "if the source is vague, the narration
  stays vague" as code rather than as a prompt wish.
- *Spatial-language check*: the generator receives an explicit `spatial_frame`
  (`{ allow: "directional" | "proximal" | "regional", distance_m, side }`) computed from real
  geometry. Phrases like "on your left" / "just ahead" are permitted **only** under
  `directional`. A regional gap-filler story containing "right here" fails. This makes the
  brief's spatial-accuracy rule mechanically enforced instead of prompt-dependent.
- *N-gram overlap check* (facts-only posture, §16.2): the narration must not lift the source's
  phrasing. Tokenise both narration and source excerpt, and fail any narration containing a
  contiguous n-gram (n=7, case/punctuation-insensitive) that also appears verbatim in the
  excerpt, excluding proper nouns, dates and a stoplist of common historical-register phrases
  ("was built in", "is listed on the", …) which would otherwise produce false positives on
  facts rather than expression. Threshold and n are config, tuned against the eval set —
  too loose lets copied phrasing through, too tight forces awkward paraphrase of standard
  factual constructions.
- *Length check*: §8.2.

**Layer 3 — LLM judge.** `claude-haiku-4-5-20251001` with structured output, asked two
things: does any sentence assert something absent from the excerpt, and does the narration
restate the source's *facts* in its own words rather than lightly editing the source's
*sentences*. Cheap, and it runs once per cache entry, not per listen. Its adequacy for the
second question is itself part of the M3 eval (§8.4) — if it can't reliably catch
near-verbatim paraphrase, the n-gram check above is the backstop of record, not the judge.

Failure path: regenerate once → on second failure, fall back to a **template extractive
card** (title, date, verbatim excerpt, link) which is grounded by construction. We degrade to
boring; we never degrade to invented.

### 8.4 Cost — why the shared cache is the whole ballgame

Per generated story: ~1,500 input tokens (cached system prompt + excerpt) and ~150 output
tokens. At Sonnet 5 rates ($2/MTok in, $10/MTok out) that's **~$0.0045 per story**
uncached — roughly 2.4× cheaper than the Opus 5 default this plan originally specced, before
caching and batching are even applied.

Then the multipliers, which are what make this viable regardless of which model is in play:

- **Shared global cache** (§4.4) — generated once per (place, length), served to every user
  forever. Cost is proportional to *places covered*, not to usage. At Sonnet rates, 100k
  places × 3 lengths ≈ **~$1.4k one-time**, not per-month.
- **Prompt caching** — the system prompt (voice rules, grounding contract, spatial frame
  vocabulary) is stable and goes before the breakpoint; the volatile excerpt goes after.
  Cache reads bill at ~10% of input. Requires the stable prefix to clear the model's minimum
  cacheable-prefix length, which the grounding contract comfortably does.
- **Batch API at 50%** — route pre-download (M5) and bulk pre-warming of a city are
  latency-insensitive by definition. This is the natural home for the corridor prefetch.

Live generation is therefore the exception, not the rule — which is also what keeps p95
latency sane.

**M3 sub-task — eval hill-climb (confirms Sonnet, doesn't just chase cheaper).** Build a
~50-story eval set spanning topics, length buckets and difficult-history cases, graded by the
§8.3 validators plus a human-reviewed voice rubric (§8.5). Run `claude-sonnet-5` against it at
`effort: low` and `medium`, with `claude-opus-5` as the quality ceiling for comparison. Two
outcomes, both actionable: Sonnet holds the bar everywhere → it's the model, full stop, and
Opus is dead code we don't call. Sonnet fails on a specific bucket (a difficult-history topic
is the likely candidate) → that bucket routes to Opus by cache-key model override, not the
whole product. Same eval separately scores whether `claude-haiku-4-5-20251001` reliably
catches near-verbatim paraphrase as the Layer 3 judge (§8.3); if it doesn't, the judge's
paraphrase check is dropped and the deterministic n-gram check carries that job alone.

### 8.5 Voice

System prompt encodes: warm, conversational, curious, occasionally lightly humorous, never
cheesy; plain language; no second-person presumption about what the user can see unless
`spatial_frame` allows it; difficult history (violence, racial injustice, disasters) handled
factually and without euphemism or true-crime relish. A named-tone test set goes in the eval
so voice regressions are caught like any other bug.

---

## 9. Audio and text delivery

- **Free tier**: Web Speech API (`speechSynthesis`), zero marginal cost.
- **Premium**: server-side TTS, cached to object storage per §4.5, streamed as audio.
- **Media Session API** for lock-screen/headphone transport controls (play/pause/skip).
- **Text card**: title, era, distance + direction (rendered from the same `spatial_frame` the
  narration was generated under, so card and audio can never disagree), narration,
  expandable source excerpt with the citation spans highlighted, source links, licence
  attribution, save button.
- **Controls**: play/pause, skip, replay, "tell me more" (regenerates at the next length
  bucket up — itself a cache key, so it's usually free), and ducking-friendly playback for use
  alongside navigation apps.

**Driving mode**: auto-play, no text entry, large hit targets, one-time "audio-first while
driving, hand the screen to a passenger" notice, persisted per user.

---

## 10. Mobile web limits — stated plainly

This is the brief's explicit flag and it deserves precision, because it determines which V1
features actually work unattended on iOS.

**What breaks on iOS Safari when the screen locks or the app backgrounds:**

- The page is suspended. Timers stop; `geolocation.watchPosition` stops delivering. The live
  loop halts — this is the core constraint and no amount of service-worker cleverness fixes
  it. iOS has no Background Sync, no Periodic Background Sync, no Background Fetch.
- Web Audio and WebRTC are suspended on lock regardless of playback state.
- `speechSynthesis` stops. The free tier is therefore screen-on only, structurally.

**What survives:** a playing `<audio>` element with Media Session metadata continues at the
lock screen, like any web audio player. It just can't be *re-fed* by JS, because JS isn't running.

**The design consequence, which I'd like to build to deliberately rather than discover:**

| Mode | Screen on | Screen locked (iOS web) |
|---|---|---|
| Live | full loop | **stops** — the honest answer |
| Route pack (M5) | full loop | **keeps playing** — see below |

A pre-downloaded route pack can be stitched into a single continuous audio timeline with
Media Session chapters, and the lock screen keeps playing it because it's one uninterrupted
element. Position-reactivity is lost, but the narration continues in route order. That turns
the iOS limitation from "the app dies in your pocket" into "the app degrades to an excellent
audio tour," and it's a real differentiator for the driving case.

Mitigations meanwhile: Screen Wake Lock API (iOS 16.4+; fixed for installed PWAs in 18.4) held
during active trips, with a clear battery warning, plus a one-time explainer.

**Native-readiness (M7)** is then a short, well-defined list: background geolocation, a
background audio session, and local notifications. Because `packages/core` never touched a
browser API, the wrapper swaps `PositionSource` and the audio sink and the scheduler is untouched.

---

## 11. Route pre-download and offline (V1 #1)

1. User enters a destination → route from OSRM/ORS (self-hosted OSRM for production; see
   `SOURCES.md` on why the demo server can't be used).
2. Sample a corridor along the polyline (points every ~500 m, buffered by mode radius).
3. Ingest + rank the corridor, then **Batch API** generate stories in route order (50% cost,
   latency irrelevant here).
4. Pre-render premium TTS for the pack.
5. Ship pack = story text + citations + audio blobs + a PMTiles corridor slice + attribution
   manifest → service worker + IndexedDB.
6. Offline playback works with the network disabled — which is exactly the acceptance
   criterion, tested in Playwright with the network cut.

---

## 12. Accounts, billing, tiers

Auth.js (email + social). Stripe Billing + Customer Portal. Webhook → `subscription` mirror.

Tiers are `tier_limit` **rows** (brief: configurable, not hard-coded). Free: browser voice,
daily story allowance, live mode only. Premium: natural voices, unlimited stories, route packs
+ offline, full trip log.

Cost protection: per-user token bucket in Redis; `usage_event` metering on every
generation/TTS second; a global daily generation ceiling with alerting, so a scraper or a bug
cannot run up an unbounded Claude/TTS bill overnight.

---

## 13. Privacy and data flows

Location is the sensitive asset; the design minimises it rather than promising to guard it.

- **Live position is processed in memory and never persisted** unless trip-log consent is on.
- **The client sends an H3 res-7 cell (~1.2 km), not raw coordinates**, for source queries.
  Heading/speed are sent as scalars. Exact coordinates stay on the device and are used only
  for on-device scheduling maths in `packages/core`.
- **Third parties never see user location.** Adapters query cell centroids, and because those
  queries are cached and shared across users, an upstream source cannot distinguish a user
  from a cache warm.
- **Trip log is strictly opt-in**, with one-tap export (JSON + GeoJSON) and hard delete;
  account deletion cascades all location history.
- Server logs: cell-level only, never raw coordinates. Structured logs record *which source
  returned what and why a story was chosen* (brief requirement) keyed by story/cluster id, not user position.

`PRIVACY.md` placeholder with a plain-language policy and this data-flow table ships in M1.

---

## 14. Developer experience and testing

**GPS simulator** — first-class, not an afterthought: GPX replay at 1×/4×/16×, with
`tracks/downtown-walk.gpx`, `tracks/coastal-bike.gpx`, `tracks/highway-drive.gpx`. Because it's
a `PositionSource` + virtual `Clock`, the entire loop runs at a desk, deterministically, with
no GPS and no wall-clock waiting.

**Unit tests** (mandated coverage): mode detection incl. anti-flicker traces; ahead-ness and
closest-approach geometry (property-based); ranking ordering; dedup across sources; every §8.3
grounding validator, with a fixture suite of deliberately hallucinated narrations that must all fail.

**Adapter integration tests**: recorded HTTP fixtures per source, so CI never hits live APIs —
which, given §16.1, is also what lets CI work at all in a restricted network.

**Acceptance tests as executable criteria** — the four MVP criteria encoded directly:

1. Replay `highway-drive.gpx` → assert max silence gap < 15 s, zero repeats, and every story
   *completes* before its place is passed.
2. Assert every narrated numeral/entity maps to a citation span.
3. Assert walking→driving transition shortens stories and widens look-ahead.
4. Playwright: load route pack, disable network, assert full playback.

Structured logging (pino) of source→result and rank→decision, as the brief requires.

---

## 15. Milestones

| # | Milestone | Exit criteria | Status |
|---|---|---|---|
| 0 | Skeleton | Monorepo, CI, Postgres+PostGIS via compose, `packages/core` geo + mode with tests, GPX simulator replaying a track | Done |
| 1 | Core loop | Live geolocation, mode detection, Wikipedia GeoSearch, raw excerpts read by browser voice, simulator drives the whole loop end-to-end | Done, with one caveat — see below |
| 2 | Multi-source | Wikidata + Overpass + NRHP adapters, normalisation, dedup/clustering, ranking, gap-filler cascade with regional decks | Done, with caveats — see below |
| 3 | Storytelling | Claude generation, citations, all three grounding layers, length scaling, shared cache, eval set + voice tests | Done, with caveats — see below |
| 4 | Surface | Text cards with citation highlighting, MapLibre map view, topic filters, trip log | Not started |
| 5 | Offline | Routing, corridor sampling, Batch pre-generation, PMTiles slice, service worker + IndexedDB, offline playback test green | Not started |
| 6 | Commerce | Auth, Stripe, premium TTS, metering, rate limits, configurable tiers | Not started |
| 7 | Native-readiness | Written review of what Capacitor needs; spike proving background location + audio against unmodified `packages/core` | Not started |

**Milestone 1 caveat:** the Wikipedia adapter is built and unit-tested against hand-authored
fixtures, not a verified live response — this environment's egress proxy still refuses
`en.wikipedia.org` (§16.1). Everything else — live geolocation, the mode classifier, the H3
privacy-rounding + real-distance recomputation in the API, and the simulator driving the whole
client loop — has been verified with a real browser (Playwright) against the running app, up to
and including the `/feed` call reaching the API and failing gracefully (502, not a crash) at
exactly the point the network block takes effect.

**Milestone 2 caveats:**

- **All three new adapters are fixture-tested, not live-verified** — same
  egress block as M1, now also covering `query.wikidata.org` and
  `overpass-api.de`. Wikidata's fixtures carry an extra caveat beyond
  "shape unverified": the SPARQL query *syntax* itself (each clause is a
  documented WDQS pattern, but the composed query has never actually run)
  — see `services/adapters/wikidata/fixtures/README.md`.
- **NRHP has no bulk dataset yet.** This environment can't reach
  `public-nps.opendata.arcgis.com` either, and there's still no Postgres
  wiring to load a bulk dataset into. `services/adapters/nrhp` ships a
  small, explicitly-fictional placeholder dataset (`src/dataset.ts`)
  standing in for the real bulk table, so the query/normalise logic has
  something to run against. Swapping in the real dataset is a `dataset`
  parameter, not a rewrite — but the real NPS field-name mapping doesn't
  exist yet and needs the actual downloaded schema to write.
- **The gap filler is one practical tier, not the full §7.6 cascade.**
  It finds the nearest Wikidata-typed settlement (city/town/village) and
  serves that settlement's own Wikipedia article, honestly framed — not
  the full neighbourhood → city → county → state widening cascade sketched
  above. WDQS has no cheap point-in-polygon query, so "nearest settlement"
  approximates "containing admin area" rather than computing it exactly.
  Good enough to never go silent; not the richer multi-tier framing
  eventually worth building once there's a real admin-boundary source.
- **Verified live, end-to-end, against the real (blocked) network:** with
  all three live sources correctly failing (403) and gracefully caught,
  the API fell back to the local NRHP dataset and returned real ranked
  results with **HTTP 200**, not the 502 an M1-era single-source design
  would have returned. At a location with nothing in any source, the gap
  filler's own failure (same network block) degraded to `{"places": []}`
  at **200**, not a crash. Confirmed both via direct API calls and via a
  full browser (Playwright) driving the simulator against the running
  web app.
- **No Postgres/persistence yet**, same as M1 — every request still
  refetches live (or, for NRHP, re-filters the in-memory sample). The
  `coverage_cell` caching design (PLAN.md §4.3) stays a Milestone-3-or-later
  addition; nothing in M2 depended on it.

**Milestone 3 caveats:**

- **No real Anthropic API credential in this environment.** Unlike the M1/M2
  third-party sources, `api.anthropic.com` itself is *not* blocked by the
  egress proxy — it's in the proxy's `noProxy` list — but no
  `ANTHROPIC_API_KEY` is configured here, so Anthropic's own auth rejects
  every real call. Generation (`generateNarration`), the judge
  (`judgeNarration`), and citations parsing are all verified only via unit
  tests against an injected fake `messages` client, following the same
  dependency-injection pattern as the M1/M2 adapters.
- **One real, non-mocked verification was still possible:** booting the
  actual API server with a real `new Anthropic()` client (reading
  `ANTHROPIC_API_KEY` from the environment, which is unset) and issuing a
  real `curl` request to `/story`. The request reaches the real SDK, whose
  own client-side `validateHeaders` rejects it before any network round
  trip (no API key), `buildStory`'s attempt loop correctly treats that
  thrown error as a failed attempt, retries once, and — both attempts
  failing the same way — degrades to the grounded template fallback,
  returning **HTTP 200** with real narration text (the source excerpt),
  not a 502. This proves the resilience design end-to-end against a real
  failure mode, just not a real model *response*.
- **The eval set (`services/storytelling/eval/`) exists but has never
  run.** Six hand-picked fixtures stress each Layer 2 grounding check
  individually (numeric precision, decade-vagueness, regional framing, a
  thin-source/length-target tension case, a difficult-history voice case,
  and a citation-heavy case) plus the Layer 3 judge, specifically to
  compare `claude-sonnet-5`'s generation quality against
  `claude-haiku-4-5-20251001`'s judging reliability — the two open
  questions from the user's runtime-model resolution. `eval/run.ts` is
  written and typechecks against the real SDK types; `eval/README.md`
  documents exactly how to run it once a credential exists and what each
  fixture is meant to reveal.
- **No Postgres-backed shared cache yet.** `StoryCache` is a proper
  interface (so swapping in a persistent implementation is not a
  calling-code change), but `InMemoryStoryCache` is the only
  implementation — cached narrations are lost on every server restart,
  same limitation M1/M2 already carried for the feed itself.
- **The gap-filler/spatial-frame interaction is handled but only
  unit-verified:** a gap-filler `PlaceEvent`'s coordinates are a stand-in
  settlement's, not the narrated content's, so `isRegional: true` forces
  `apps/api/src/story.ts` to skip geometric spatial-frame computation
  entirely and hard-code `{allow: "regional", ...}` — correct by
  construction, but never exercised against a real gap-filler place
  produced by a live NRHP/Wikidata lookup (M2's own live-verification gap).
- **Verified live, end-to-end, with a real browser:** Playwright driving
  the GPS simulator against the running web app confirms the UI correctly
  shows the "Generating narration…" state, then the template-fallback
  narration and its "didn't pass grounding" note, with zero console
  errors and no silent playback gap — the same "never go silent"
  guarantee as M1/M2, now covering the new `/story` call too.

MVP acceptance (§14) is evaluated at the end of M5; M6–M7 are productisation.

---

## 16. Open risks

### 16.1 BLOCKING: the dev container cannot reach the content sources

I verified this rather than assuming it. Every content-source host is refused by this
environment's egress proxy with a 403 at CONNECT:

```
en.wikipedia.org      CONNECT tunnel failed, 403
query.wikidata.org    CONNECT tunnel failed, 403
overpass-api.de       CONNECT tunnel failed, 403
www.loc.gov           CONNECT tunnel failed, 403
```

The proxy documentation is explicit that these are organisation policy denials and must be
reported rather than worked around, so I have not attempted to route around it.

**What this does and doesn't block.** It does *not* block M0 or most of M2–M5: adapters are
built against recorded fixtures, `packages/core` is pure, and the simulator needs no network.
It *does* block recording those fixtures in the first place, and it blocks the M1 exit
criterion of a live GeoSearch call.

**Options, in the order I'd pick them:**
1. Allowlist the five hosts in `SOURCES.md` for this environment — cleanest, unblocks everything.
2. I build fixture-first with hand-written fixtures from documented response shapes; you run a
   one-off recording script locally and commit the real fixtures. Slower and the fixtures start unverified.
3. Defer all network-touching work to local development; this environment does core + tests only.

This needs your decision; it isn't something I can resolve in code.

### 16.2 Licensing: resolved — facts-only extraction, not textual derivation

Wikipedia text is CC BY-SA 4.0. §8.3 already required strict grounding — no fact in the
narration may be absent from the source excerpt. The open question was whether staying that
faithful to the source's *content* also meant inheriting the source's *expression*, which would
pull the ShareAlike term onto our narration and sit awkwardly beside a paid premium tier.

**Decision: facts-only.** We build on the ordinary copyright distinction between facts (not
protected) and expression (protected) rather than on any posture toward BY-SA. Grounding
constrains narration to facts stated in the excerpt; it does not, and must not, constrain
narration to the excerpt's *sentences*. Concretely:

- The generation prompt instructs the model to extract facts and retell them in the product's
  own voice (§8.5), never to lightly edit source sentences — this is a prompt-level rule,
  not just an aspiration, because it's also mechanically checked next.
- The new **n-gram overlap validator** (§8.3, Layer 2) makes this a hard gate rather than a
  style preference: narration sharing a source's phrasing beyond common factual boilerplate
  fails validation and regenerates, same as an invented fact would.
- Attribution and source links stay on every card regardless — attributing sources we drew
  facts from is table stakes for an app called "Hereabouts," not a licence obligation we're
  trying to minimize.
- The `license` column (§4.1) and per-story licence provenance (§4.4) stay in the schema
  exactly as designed. This posture is a product policy, not a schema constraint, so nothing
  here forecloses posture (b) — segmenting premium content by source licence — later if the
  facts-only line ever looks thinner than expected for a specific source.

This is a product-policy call, not legal advice, and it doesn't touch OSM's ODbL (a database
right, addressed separately in §16.3 by not redistributing the raw database) or the
public-domain sources, which were never in question.

### 16.3 Other risks

| Risk | Mitigation |
|---|---|
| **Overpass fair use** — public instances explicitly forbid app backends | Self-host Overpass (or use planet extracts) before any real traffic. Public instance for dev only. Budget: one moderate VM + regional extract |
| **WDQS reliability** — public SPARQL is slow and timeout-prone in 2026 | Treat as a batch enrichment source, never in the request path. Cache hard. Degrade silently |
| **loc.gov Cloudflare challenge** — reported to challenge programmatic clients on first request | Lowest-confidence source; deferred to M4+. Batch-only ingest with backoff; drop it entirely if it proves unreliable |
| **Content deserts** — rural coverage is thin | The gap-filler cascade is the answer, which is why it's M2 and not a late add. Measure "stories per km" on real tracks per mode |
| **TTS cost blowup** | Per-story-per-voice caching + metering + global ceiling (§12) |
| **Tile costs** | Self-hosted PMTiles keeps marginal cost near zero (§2.3) |
| **Battery drain** — continuous GPS + wake lock + audio | Measure on real devices in M1; adaptive polling (slower fixes when stationary); surface an honest battery warning |
| **iOS lock-screen limits** | Not fixable on the web. Made explicit in §10, turned into a route-pack strength, resolved properly in M7 |

---

## 17. What I need from you

Resolved: model default is `claude-sonnet-5` with an M3 eval hill-climb against `claude-opus-5`
(§8.4); licensing posture is facts-only extraction with an n-gram overlap gate (§16.2).

Outstanding:

1. **§16.1 egress** — the exact host list to allowlist is in `SOURCES.md` under "Egress
   allowlist." Once that's set (or you've confirmed local Claude Code as the fallback), M1 is
   unblocked. M0 doesn't need it and is proceeding regardless.

On approval I'll start at Milestone 0 and work through in order.
