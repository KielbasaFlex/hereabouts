# Hereabouts

A geolocated history tour app that narrates the history of wherever you are, continuously, as
you walk, bike, or drive.

Start with [`PLAN.md`](./PLAN.md) (architecture, stack, milestones),
[`SOURCES.md`](./SOURCES.md) (content-source API/licence verification), and
[`NATIVE_READINESS.md`](./NATIVE_READINESS.md) (Milestone 7's Capacitor
review). All three are living documents, kept current as decisions are made.

## Status

**Milestone 7: native-readiness — the last milestone in PLAN.md's table.**
`apps/native` is a real spike proving Capacitor can wrap this app without
touching `packages/core`: it implements the existing `PositionSource`
interface twice (foreground `@capacitor/geolocation`, background
`@capacitor-community/background-geolocation`) and a new `PlaybackSink`
interface (extracted from `apps/web/src/speech.ts` into
`packages/core/src/playback/`, a zero-behavior-change move) once, for
native TTS (`@capacitor-community/text-to-speech`), plus a local
notifications wrapper. All three adapters typecheck against
`packages/core`'s real, unmodified interfaces and their mapping/lifecycle
logic is covered by 21 unit tests. A real `npx cap add android` scaffolded
a real Android Gradle project that correctly discovered all 5 native
plugins; running its own `./gradlew tasks` for real got as far as
downloading and booting Gradle before failing at one precisely identified
point (`dl.google.com` returning 403 — see below). See
`NATIVE_READINESS.md` for the full written review and
`apps/native/README.md` for the spike's exact verified/unverified
boundary.

**Milestone 6: commerce.** On top of Milestone 5's offline packs, the app now has real accounts,
billing, and tiered limits: `packages/db` (Drizzle + Postgres) persists users, sessions,
subscriptions, and configurable tier limits; `services/auth` handles email+password sign-up/log-in
with a hand-rolled Postgres-backed session (not Auth.js — see `PLAN.md`'s Milestone 6 caveats for
why); `services/billing` integrates the real Stripe SDK for Checkout/Portal sessions and
cryptographically verifies webhooks; `services/tts` adds a premium TTS provider interface and
local audio storage; and `apps/api` gates `/story`/`/route-pack` behind a real Redis-backed daily
cap + a global generation ceiling. This sandbox happened to have a native Postgres and Redis
available, so — for the first time in this project — the persistence and rate-limiting layers are
verified against **real** databases, not mocks. See `PLAN.md` §15 for the full milestone list and
its Milestone 6 caveats section for exactly what's simplified or unverified.

**Known gaps (all explicitly flagged in `PLAN.md`/`SOURCES.md`, not silent):**

- This environment cannot reach `en.wikipedia.org`, `query.wikidata.org`, `overpass-api.de`, or
  `router.project-osrm.org` — all four live-network adapters are fixture-tested, not verified
  against a real response. See each adapter's `fixtures/README.md`.
- NRHP has no real bulk dataset yet — it runs against a small, explicitly-fictional placeholder
  dataset. See `services/adapters/nrhp/fixtures/README.md`.
- The gap filler is one practical tier (nearest named settlement), not the full
  neighbourhood → city → county → state cascade `PLAN.md` §7.6 sketches.
- **No `ANTHROPIC_API_KEY` in this environment**, so live generation, batch pre-generation, and
  the eval set are verified only via unit tests against injected fakes, plus real-but-unauthenticated
  requests proving each one's resilience path. `api.anthropic.com` itself is *not* network-blocked.
- **`api.stripe.com`, `api.openai.com`, and `api.elevenlabs.io` are all blocked** — Stripe
  Checkout/Portal and the OpenAI TTS provider are unit-tested against their real SDKs' types but
  have never completed a live request. **Webhook signature verification is real, not mocked**,
  though: this session generated a genuinely signed test webhook and sent it to the actual running
  API, which correctly verified it and wrote a real premium subscription into a real Postgres
  database. See `services/billing/fixtures/README.md` and `services/tts/fixtures/README.md`.
- **Auth.js is intentionally not used** — see `PLAN.md`'s Milestone 6 caveats for the reasoning.
  Google/GitHub OAuth exist as real, reachable-endpoint URL-building and code-exchange functions
  (`services/auth/src/oauth/`) but aren't wired into `apps/api`'s routes yet, and can't complete a
  real login without a registered OAuth app.
- **The content pipeline (`place_event`/`story`/`coverage_cell`) is still in-memory** — Milestone
  6's Postgres wiring is scoped to the account/billing tables Commerce needs, not a retroactive
  migration of everything from earlier milestones.
- **Topic filters classify from text, not a real category field**, and **map tiles / PMTiles byte
  data are unreachable/unproduced in this environment** — see `PLAN.md`'s Milestone 4/5 caveats.
- **No premium audio playback wired into the web client yet** — `/tts` exists server-side with
  real tier gating, but `apps/web` still uses Web Speech for every tier.
- **The trip log is still client-local (`localStorage`) only**, not yet tied to the new account
  system — see `PLAN.md`'s Milestone 6 caveats.
- **MVP acceptance criteria #1–#3 (§14) remain unautomated** — only #4 (route-pack offline
  playback, from Milestone 5) has a dedicated, repeatable check behind it from this build.
- **No compiled/running native build exists.** This environment has no Android SDK (and the
  host `sdkmanager` would need to download components from is blocked — `dl.google.com`
  returns 403) and no macOS/Xcode for iOS at all. `apps/native`'s adapters are real,
  typechecked, and unit-tested against `packages/core`'s unmodified interfaces, but no native
  binary has ever been built or run. See `NATIVE_READINESS.md`.

**What *has* been verified, live, against the real (blocked) network — and, new this milestone,
against real local infrastructure:** with all three live feed sources correctly failing and being
caught, `/feed` fell back to the local NRHP dataset and returned real ranked results at
**HTTP 200** — not a failure. Booting the API with a real `new Anthropic()` client and calling
`/story` and `/route-pack` both showed the SDK's own client-side auth check reject the request (no
key configured), and both `buildStory` and
`generateStoriesViaBatch` correctly caught that and degraded to the grounded template fallback at
**HTTP 200** rather than a 502. **The Milestone 5 centerpiece:** downloaded a real route pack
through the running web app (real corridor sampling, real ingestion against the blocked sources,
real tile-coordinate computation, a real pack saved to IndexedDB), then used Playwright's
`context.setOffline(true)` — an actual network cut — to reload the page and confirm the service
worker served the cached app shell, the downloaded pack was still listed from a real offline
IndexedDB read, and "Play offline" correctly drove sequential playback through the pack's stories
in route order with **zero network requests**. That's PLAN.md §14's fourth MVP acceptance
criterion, executed against a real browser and a real offline network condition, not a mock.
**The Milestone 6 centerpiece:** signed up a real user through the running web app (real argon2
password hashing, a real Postgres row, a real session cookie); generated a genuinely
HMAC-signed Stripe webhook payload (via the Stripe SDK's own test-signature helper — real
cryptography, not an assumption) and posted it to the live API, which verified the signature and
wrote a real `premium` subscription row into Postgres; confirmed `/me` reflected the upgrade
immediately; and confirmed a real Redis-backed daily story cap and global generation ceiling
both correctly gate `/story` (unit- and integration-tested against a real Redis instance).

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

### Local Postgres + Redis

```bash
docker compose up -d
```

If Docker isn't available (it wasn't in the sandbox this milestone was built in — see `PLAN.md`'s
Milestone 6 caveats), a native Postgres 16 + Redis 7 work identically; only the connection URLs
below need to point at them.

Then apply the schema and seed the default tiers (Milestone 6, `packages/db`):

```bash
export DATABASE_URL=postgres://hereabouts:hereabouts@localhost:5432/hereabouts
pnpm --filter @hereabouts/db run db:migrate
pnpm --filter @hereabouts/db run db:seed   # inserts the free/premium tier_limits rows
```

### Running the app

```bash
export DATABASE_URL=postgres://hereabouts:hereabouts@localhost:5432/hereabouts
export REDIS_URL=redis://localhost:6379
export ANTHROPIC_API_KEY=sk-ant-...  # optional — without it, /story degrades to the
                                      # template fallback for every request (see Status above)
export STRIPE_SECRET_KEY=sk_test_... # optional — without it, /billing/* returns a real
                                      # error response rather than crashing (see Status above)
export VITE_MAP_STYLE_URL=...        # optional — overrides the map's default (dev-only) style;
                                      # see SOURCES.md's Milestone 4 update
pnpm --filter @hereabouts/api dev    # API on :8787
pnpm --filter @hereabouts/web dev    # web app on :5173, proxies /api to the API
```

Open the web app, sign up or log in (Milestone 6 — optional; free-tier usage doesn't require an
account), pick "Simulator" and a sample track (or "Live GPS" on a device with location),
optionally select topic filters or turn on the trip log, and press Start. The status bar shows the
live-detected travel mode and speed; a map shows your position and nearby candidates; a text card
appears — read aloud automatically — whenever `/feed` finds something nearby, drawing on whichever
sources are reachable and falling back to the regional gap filler otherwise. Below that, "Offline
route packs" lets you download one of the sample tracks as a pack and play it back fully offline
(try it with your network actually disabled, once downloaded).

## Repo layout

```
packages/
  core/         # pure domain logic: geometry, mode detection, H3 cell rounding, dedup/
                # clustering, ranking, spatial-frame classification, grounding validators,
                # topic classification, corridor sampling, PMTiles tile-coordinate math,
                # GPX simulator, PositionSource/Clock/PlaybackSink platform interfaces. No I/O.
  contracts/    # shared zod schemas (PlaceEvent, /feed, Story, Route, RoutePack, ...)
  db/           # Drizzle schema + migrations: users, sessions, subscriptions, tier_limits,
                # usage_events. The only Postgres-backed package so far (Milestone 6).
services/
  adapters/
    wikipedia/  # GeoSearch + extracts, plus fetchArticleByTitle for the gap filler
    wikidata/   # SPARQL: nearby dated items, and nearest-settlement search
    overpass/   # historic=*/memorial=*/heritage=* OSM elements
    nrhp/       # local-dataset query (bulk download not yet wired — see its fixtures/README.md)
    osrm/       # driving-route polyline lookup (dev-only demo server — see its fixtures/README.md)
  storytelling/ # Claude generation + citations, 3-layer grounding, shared cache, Batch API
                # pre-generation, eval set
  auth/         # email+password sessions (argon2 + Postgres), Google/GitHub OAuth building blocks
  billing/      # Stripe Checkout/Portal session creation, webhook signature verification
  tts/          # premium TTS provider interface (OpenAI-shaped) + local audio storage
apps/
  api/          # Hono server: POST /feed, /story, /route-pack, /auth/*, /billing/*, /tts, GET /me
  web/          # Vite + React app: live/simulated position, mode detection, narration, offline
                # route packs (IndexedDB + service worker), account/billing UI
  native/       # Milestone 7 spike: Capacitor adapters (background geolocation, native TTS,
                # local notifications) implementing packages/core's unmodified interfaces, plus
                # a real (uncompiled — see NATIVE_READINESS.md) Android project scaffold
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

`api.stripe.com`, `api.openai.com`, and `api.elevenlabs.io` (Milestone 6's billing and premium
TTS) are blocked the same way. `accounts.google.com`, `oauth2.googleapis.com`, `github.com`, and
`api.github.com` (Milestone 6's OAuth) are a genuinely different case — all four are reachable —
see `SOURCES.md`'s Milestone 6 update and `services/auth/fixtures/README.md` for what's still
missing (a registered OAuth app, not network access).

`dl.google.com` (Milestone 7's Android build — the Android Gradle Plugin is published there) is
blocked the same 403-at-CONNECT way. `services.gradle.org` and `maven.google.com` are both
reachable, which is how far a real `./gradlew tasks` run got before failing — see
`NATIVE_READINESS.md` and `apps/native/README.md`.
