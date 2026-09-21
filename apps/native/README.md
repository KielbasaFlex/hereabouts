# `@hereabouts/native` — Milestone 7 spike

This package is the native-readiness spike PLAN.md §15's Milestone 7 asks for:
"a spike proving background location + audio against unmodified
`packages/core`." It is not a shippable app — there's no build pipeline
wiring `apps/web`'s bundle into it yet — it exists to prove the specific,
checkable claim PLAN.md §2.1 makes: that native support is "a shell swap,
not a rewrite."

## What's real and verified in this environment

- **Real npm dependency resolution**, at correct, mutually compatible
  versions. The first pass guessed Capacitor major v6 from stale training
  knowledge and `pnpm install` caught it immediately with a real
  peer-dependency warning (`@capacitor-community/text-to-speech` needs
  `@capacitor/core@>=7`). Checking the npm registry directly showed the
  real current major is 8; every `@capacitor/*` dependency here is pinned
  to it, and `pnpm install` now reports zero warnings.
- **Real TypeScript compilation against the plugins' actual installed
  `.d.ts` files** — `CapacitorPositionSource` (`@capacitor/geolocation`),
  `BackgroundPositionSource` (`@capacitor-community/background-geolocation`),
  and `CapacitorSpeechController` (`@capacitor-community/text-to-speech`)
  all implement `packages/core`'s existing `PositionSource` and
  `PlaybackSink` interfaces (the latter newly extracted from
  `apps/web/src/speech.ts` into `packages/core/src/playback/`, itself a
  zero-behavior-change refactor — `apps/web` re-exports it as a type alias
  and its own test suite still passes unchanged). **`packages/core` needed
  zero modifications** to accept these adapters — `tsc --noEmit` passes on
  both packages with no `any`-casting at the interface boundary.
- **21 unit tests**, all real logic exercised against fake-but-realistic
  plugin objects (never a mock of `packages/core` itself): the
  speed/heading-derivation-when-null fallback (mirroring
  `LiveGeolocationSource`'s existing browser behavior), error propagation,
  watcher lifecycle (start/stop calling the right plugin methods with the
  right IDs), and the TTS adapter's "stop before speak" and pause/no-resume
  behavior.
- **Real `npx cap init` and `npx cap add android`** — genuine Capacitor CLI
  8.5.2 operations, not simulated. `cap add android` really scaffolded
  `android/` (a real Gradle Android Studio project, ~700KB, committed) and
  correctly auto-discovered and registered all 5 Capacitor plugins this
  package depends on by reading their installed `package.json` files.
- **A real, precisely-located build failure**, not an assumption: running
  the generated project's own `./gradlew tasks` really downloaded and
  booted Gradle 8.14.3 (`services.gradle.org` is reachable), really started
  configuring the Android project, and failed at exactly one point —
  resolving `com.android.tools.build:gradle:8.13.0` and
  `com.google.gms:google-services:4.4.4` from `dl.google.com`, which
  returns **HTTP 403** in this environment (same egress-proxy treatment as
  every other blocked host this project has documented — Wikipedia,
  Wikidata, Stripe, OpenAI, etc.). `maven.google.com` itself answers (301),
  but the Android Gradle Plugin is published under `dl.google.com`'s
  `/dl/android/maven2` path specifically, which is what's blocked.

## What is not verified, and exactly why

- **No compiled/running Android build.** Blocked on two independent
  things, either of which alone would stop it: (1) `dl.google.com` is
  blocked at this environment's egress proxy (confirmed above, a genuine
  network limitation, not a missing credential), and (2) there is no
  Android SDK installed (`ANDROID_HOME` unset, no `sdkmanager` binary
  anywhere on the box) — `sdkmanager` itself would need to download
  components from the same blocked host. Java 21 and Gradle are both
  natively present and functional; that's as far as this environment lets
  a real Android build get.
- **No iOS verification at all.** Building or running an iOS target
  requires Xcode on macOS; this environment is Linux with none of that
  toolchain. Every iOS-specific claim in `NATIVE_READINESS.md` (background
  modes, Info.plist keys, App Store review risk) is documented from
  Apple's public developer documentation, not exercised here.
- **No real device/emulator location or audio behavior.** The adapters'
  *mapping logic* (plugin shape → `PositionFix`/`PlaybackSink` calls) is
  real and unit-tested; the plugins' own native behavior (does background
  location actually keep delivering fixes with the screen off; does
  `category: "playback"` actually keep audio alive in the background) is
  asserted from each plugin's own documentation, not observed.
- **`CapacitorSpeechController.resume()` is a documented no-op**, not a
  simplification hiding a bug: `@capacitor-community/text-to-speech`'s
  real API (confirmed from its installed `.d.ts`) only exposes
  `speak()`/`stop()`, with no pause/resume primitive at all, unlike
  `window.speechSynthesis`. `pause()` here stops playback outright.
- **`www/index.html` is a placeholder shell**, committed only so
  `cap add android` had something to copy into the native project. No
  build step yet copies `apps/web`'s real Vite output here — see
  `capacitor.config.ts`'s comment.
- **Notification content/UX (`NearbyStoryNotifier`) is unstyled and
  untriggered** — it's a thin, tested wrapper proving the interface shape
  works, not wired into any scheduler decision about when a "nearby story"
  notification should actually fire.

## Before this is considered done

1. With a real Android SDK (or `dl.google.com` reachable): run
   `./gradlew assembleDebug` in `android/` for real, install the APK on an
   emulator, and confirm the app boots (WebView renders `apps/web`'s real
   bundle once wired in).
2. On a real Android device: confirm `BackgroundPositionSource` keeps
   delivering fixes with the screen locked, and that `CapacitorSpeechController`
   keeps narrating in that state (the actual claim PLAN.md §10 makes).
3. On macOS with Xcode: add the iOS platform (`cap add ios`), configure
   `UIBackgroundModes` (`location`, `audio`) and
   `NSLocationAlwaysAndWhenInUseUsageDescription` in `Info.plist`, and
   repeat the same locked-screen check.
4. Wire `apps/web`'s build output into `webDir` and swap
   `LiveGeolocationSource`/`createSpeechController()` for
   `CapacitorPositionSource`/`BackgroundPositionSource`/
   `CapacitorSpeechController` behind a platform check (`Capacitor.isNativePlatform()`).

See `NATIVE_READINESS.md` at the repo root for the full written review
(architecture, permissions/config needed per platform, App Store/Play
Store review-risk considerations, and an effort/risk table).
