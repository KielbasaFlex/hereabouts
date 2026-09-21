# Native readiness — Milestone 7

This is the written review PLAN.md §15's Milestone 7 asks for: what wrapping
Hereabouts as a native app with Capacitor actually needs, informed by a real
spike (`apps/native`) rather than a survey of documentation alone. See
`apps/native/README.md` for the spike's exact verified/unverified boundary;
this document is the analysis that spike exists to support.

## 1. Why Capacitor, restated

PLAN.md §2.2 chose a Vite SPA over Next.js specifically because "Capacitor
wraps a static bundle" — an SSR app has to be coerced into `output: export`
to get there, losing the reasons to pick SSR in the first place. Capacitor
wraps that static bundle in a native WebView shell and exposes native
capability through a plugin bridge; the web app's code doesn't change to run
inside it, only the platform-specific pieces PLAN.md §2.1 deliberately kept
out of `packages/core` do.

The concrete architectural bet (§2.1): `packages/core` never imports
`fetch`, `navigator`, or any browser/Node global. Position arrives through a
`PositionSource` interface; narration audio will go out through a
`PlaybackSink` interface (added this milestone, see §3 below). A native
build supplies new implementations of both. Everything else — mode
detection, the queue/scheduler, grounding, ranking — runs unmodified. This
document's central finding, backed by the spike, is that **this bet paid
off**: zero lines of `packages/core` changed to make the native adapters
typecheck against its own interfaces.

## 2. What Capacitor actually needs, concretely

| Piece | Capacitor plugin (real, installed, version-checked) | Purpose |
|---|---|---|
| Foreground location | `@capacitor/geolocation` (official) | Drop-in native equivalent of `navigator.geolocation`, for parity when the app is foregrounded |
| Background location | `@capacitor-community/background-geolocation` (community) | The actual Milestone 7 requirement — location fixes that keep arriving with the screen locked or the app backgrounded, which no web API can do (§10) |
| Native TTS | `@capacitor-community/text-to-speech` (community) | Narration audio that can be configured to survive backgrounding (`category: "playback"` on iOS), replacing `window.speechSynthesis`, which iOS suspends on lock (§10) |
| Local notifications | `@capacitor/local-notifications` (official) | Telling the user a story is available when `BackgroundPositionSource`, not the UI, is what noticed a nearby place |
| App lifecycle | `@capacitor/app` (official) | Detecting foreground/background transitions, to decide when to hand off between the foreground and background position sources |
| Android platform | `@capacitor/android` + `@capacitor/cli` | Native project scaffolding and build tooling |

Two plugins were deliberately **not** added this milestone because nothing
in the current app needs them yet: `@capacitor/preferences` (native
key-value storage — `localStorage`-equivalent, relevant if the trip log
(PLAN.md §4.6) ever needs to survive an app reinstall) and any push
notification plugin (nothing in this app currently needs server-initiated
push; local notifications, scheduled from data already on the device, cover
the one identified use case).

All six versions above were confirmed against the real npm registry, not
recalled from training data — the first attempt guessed Capacitor's major
version wrong (v6; the real current major is 8) and `pnpm install` caught it
immediately via a real peer-dependency conflict. See
`apps/native/README.md` for that story in full.

## 3. The `PlaybackSink` extraction

`apps/web/src/speech.ts` already had exactly the right interface
(`isSupported`/`speak`/`pause`/`resume`/`cancel`) wrapping
`window.speechSynthesis`; it just lived in `apps/web`, not
`packages/core`. This milestone moved it to
`packages/core/src/playback/index.ts` as `PlaybackSink`, alongside the
existing `PositionSource`/`Clock` platform-abstraction interfaces, with
`apps/web/src/speech.ts` now re-exporting it as a type alias
(`export type SpeechController = PlaybackSink`). This was confirmed
zero-behavior-change before making it: `apps/web/src/App.tsx` is the only
consumer, and it only imports the `createSpeechController` factory
function, never the type — so no call site needed to change, and both
packages' existing test suites pass unchanged after the move.

This makes PLAN.md §2.1's "the wrapper swaps `PositionSource` and the audio
sink" claim a structural, compiler-checked fact rather than a design
intention: both interfaces a native build needs to satisfy now live in the
same zero-I/O package, and `apps/native/src/speechController.ts`'s
`CapacitorSpeechController implements PlaybackSink` proves a native
implementation can satisfy it without modification.

## 4. Platform-specific configuration needed (not yet done — no device/Xcode to verify against)

### Android

- **`ACCESS_BACKGROUND_LOCATION` permission** (Android 10+) — required
  alongside `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` for
  `@capacitor-community/background-geolocation` to keep receiving updates
  with the app backgrounded. Since Android 11, this must be requested as a
  *separate*, second permission dialog after fine/coarse location is
  already granted — the OS refuses to show both at once.
  - **Google Play review risk (high):** apps requesting background location
    go through Play's stricter "Background Location" declaration form and a
    manual review, and Play requires the feature to be clearly essential to
    the app's core function (demonstrated in-app, not just declared) —
    Hereabouts' entire premise (continuous narration while locked/backgrounded)
    is a strong, easy case to make, but it needs a prominent in-app
    disclosure screen before the permission request per Play policy, not
    just the OS permission dialog.
- **Foreground service + persistent notification.** Android requires a
  foreground service with an ongoing notification to keep a background
  location watcher alive past a few minutes; this is what
  `WatcherOptions.backgroundMessage`/`backgroundTitle` in
  `@capacitor-community/background-geolocation`'s real API (confirmed from
  its installed `.d.ts`, see `apps/native/src/backgroundPositionSource.ts`)
  configure. The notification text needs to honestly describe what's
  happening ("Hereabouts is narrating your route"), both for Play policy
  and because a vague notification is a common one-star-review cause for
  this category of app.
- **Notification channel (Android 8+)** for local notifications —
  `@capacitor/local-notifications`' `createChannel` needs to be called once
  at startup with an explicit `importance` level; `NearbyStoryNotifier`
  (`apps/native/src/notifications.ts`) doesn't do this itself since channel
  creation is an app-lifecycle concern, not this class's.
- **`POST_NOTIFICATIONS` runtime permission (Android 13+)** — handled
  automatically by `@capacitor/local-notifications` 8.3+'s `schedule()`
  (confirmed from its installed `.d.ts`: it now requests the permission
  itself if not already granted), so `NearbyStoryNotifier.ensurePermission()`
  is a belt-and-suspenders explicit check, not the only path.

### iOS (unverified — no macOS/Xcode in this environment)

- **`UIBackgroundModes`** in `Info.plist` needs both `location` and `audio`
  entries: `location` to keep receiving background location updates,
  `audio` to keep the native TTS session alive while backgrounded (the
  `category: "playback"` option `@capacitor-community/text-to-speech`
  exposes, confirmed from its `.d.ts`, is the iOS-side half of this — it
  needs the `Info.plist` entry to actually take effect).
- **`NSLocationAlwaysAndWhenInUseUsageDescription`** (and
  `NSLocationWhenInUseUsageDescription`) — both required text strings
  explaining *why* the app needs background location; App Review reads
  these and will reject vague copy ("for location services") for an app in
  this category.
- **App Store review risk (high, same shape as Play):** apps requesting
  "Always" location authorization go through heightened scrutiny; Apple's
  guidelines require the background use to be a core, demonstrable feature
  (again, an easy case for Hereabouts specifically) and increasingly expect
  a clear one-time in-app explanation screen before the system prompt,
  which iOS 13+'s two-step permission flow (When-In-Use first, Always as a
  separate later request) makes almost mandatory in practice, not just good
  practice.
- **No native pause/resume for TTS.** `@capacitor-community/text-to-speech`'s
  real API (confirmed from its `.d.ts`) only exposes `speak()`/`stop()` —
  no pause/resume primitive on either platform, unlike
  `window.speechSynthesis`. `CapacitorSpeechController.pause()` stops
  playback outright and `resume()` is a documented no-op (see
  `apps/native/src/speechController.ts`). If true pause/resume matters for
  the native UX, it needs either a different plugin or tracking playback
  position ourselves and re-issuing `speak()` from a computed offset —
  neither attempted this milestone.

## 5. Effort/risk table

| Capability | Engineering effort | External risk |
|---|---|---|
| Foreground location (`CapacitorPositionSource`) | Low — built and unit-tested this milestone | None; official plugin, stable API |
| Background location (`BackgroundPositionSource`) | Low-medium — built and unit-tested this milestone; real device tuning (distance filter, notification wording) still needed | Medium — community-maintained plugin, not official; Play/App Store review friction (§4) is the bigger risk than the code |
| Native TTS (`CapacitorSpeechController`) | Low — built and unit-tested this milestone | Medium — community-maintained plugin; no pause/resume is a real UX gap to design around, not fixed by more engineering effort alone |
| Local notifications (`NearbyStoryNotifier`) | Low — built and unit-tested this milestone; deciding *when* to notify (scheduler logic) is unbuilt | Low; official plugin |
| Android build | Not started | High in *this* environment specifically — blocked on a missing Android SDK and a blocked `dl.google.com` (§6); low risk generally, since this is a standard Capacitor/Gradle setup with no exotic native code |
| iOS build | Not started | High in *this* environment (no macOS/Xcode at all); the App Store background-location review process (§4) is the main risk once building is possible |
| Wiring `apps/web`'s bundle into `apps/native` | Not started, small | Low — mechanical (`webDir` pointing at a real build output, `Capacitor.isNativePlatform()` branching to pick the native adapters) |

## 6. What this milestone's spike verified, precisely

Real, not simulated:

- `pnpm install` resolving the actual Capacitor 8 plugin ecosystem with
  zero peer-dependency warnings (after a real, self-caught version-guess
  error — see `apps/native/README.md`).
- `tsc --noEmit` passing for `apps/native` with its adapters implementing
  `packages/core`'s real, unmodified `PositionSource`/`PlaybackSink`
  interfaces, and for `packages/core` and `apps/web` after the
  `PlaybackSink` extraction.
- 21 unit tests covering the three adapters' mapping/lifecycle logic
  against fake-but-API-accurate plugin objects.
- `npx cap init` and `npx cap add android` — genuine Capacitor CLI 8.5.2
  operations that scaffolded a real Android Studio project and correctly
  auto-discovered all 5 native plugins.
- Running the generated project's `./gradlew tasks` for real: Gradle 8.14.3
  really downloaded and booted (`services.gradle.org` is reachable), and
  the build failed at one precisely identified point — resolving the
  Android Gradle Plugin from `dl.google.com`, which returns **HTTP 403**
  here, the same egress-proxy treatment PLAN.md §16.1 documents for every
  other blocked host this project has hit (Wikipedia, Wikidata, Overpass,
  OSRM, Stripe, OpenAI, ElevenLabs).

Not verified, and not claimed to be:

- Any compiled or running native binary, Android or iOS.
- Real background-location or background-audio behavior on a device —
  every claim about what survives backgrounding is sourced from each
  plugin's own documentation plus this project's own prior, real finding
  from Milestone 5 that a playing `<audio>` element survives an iOS lock
  screen (§10), not from observing the native plugins directly.
- Any App Store / Play Store review outcome — §4's review-risk assessment
  is informed analysis of published policy, not a completed submission.
