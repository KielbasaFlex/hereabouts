import type { PlaceEvent, RoutePack, Story } from "@hereabouts/contracts";
import type { Mode } from "@hereabouts/core";
import { parseGpx, type PositionSource } from "@hereabouts/core/sim";
import type { TopicId } from "@hereabouts/core/topics";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { fetchRoutePack, fetchStory } from "./api";
import { RoutePackPanel } from "./components/RoutePackPanel";
import { TextCard } from "./components/TextCard";
import { TopicFilters } from "./components/TopicFilters";
import { TripLogPanel } from "./components/TripLogPanel";
import { downloadTextFile } from "./download";
import { formatMode, formatSpeed } from "./format";
import { useFeed } from "./hooks/useFeed";
import { usePositionFix } from "./hooks/usePositionFix";
import { deleteRoutePack, listRoutePacks, saveRoutePack } from "./offlineStore";
import { LiveGeolocationSource } from "./position/liveGeolocationSource";
import { SimulatedPositionSource } from "./position/simulatedSource";
import { createSpeechController } from "./speech";
import {
  appendTripLogEntry,
  clearTripLog,
  isTripLogEnabled,
  loadTripLog,
  setTripLogEnabled,
  tripLogToGeoJson,
  tripLogToJson,
  type TripLogEntry,
} from "./tripLog";

// maplibre-gl is a large dependency (~300KB gzipped) — loaded as its own
// chunk only once the app actually starts, rather than blocking the initial
// bundle for a component most of the shell (Start button, source picker)
// doesn't need. See PLAN.md's bundle-size discipline precedent (Milestone 1's
// h3-js subpath-export fix).
const MapView = lazy(() => import("./components/MapView").then((m) => ({ default: m.MapView })));

type SourceKind = "live" | "simulator";

const SAMPLE_TRACKS = [
  { id: "downtown-walk", label: "Downtown walk", file: "downtown-walk.gpx", mode: "walking" satisfies Mode },
  { id: "coastal-bike", label: "Coastal bike ride", file: "coastal-bike.gpx", mode: "biking" satisfies Mode },
  { id: "highway-drive", label: "Highway drive", file: "highway-drive.gpx", mode: "driving" satisfies Mode },
] as const;

type TrackId = (typeof SAMPLE_TRACKS)[number]["id"];

/** PLAN.md §10: shown once per browser the first time driving mode is detected. */
const DRIVING_NOTICE_KEY = "hereabouts:driving-notice-seen";

export function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>("simulator");
  const [trackId, setTrackId] = useState<TrackId>("downtown-walk");
  const [playbackRate, setPlaybackRate] = useState(4);
  const [running, setRunning] = useState(false);
  const [positionSource, setPositionSource] = useState<PositionSource | null>(null);
  const [trackLoadError, setTrackLoadError] = useState<string | null>(null);
  const [showDrivingNotice, setShowDrivingNotice] = useState(false);
  const [currentPlace, setCurrentPlace] = useState<PlaceEvent | null>(null);
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<ReadonlySet<TopicId>>(new Set());
  const [tripLogEnabled, setTripLogEnabledState] = useState(() => isTripLogEnabled(window.localStorage));
  const [tripLogEntries, setTripLogEntries] = useState<TripLogEntry[]>(() => loadTripLog(window.localStorage));
  const [downloadedPacks, setDownloadedPacks] = useState<RoutePack[]>([]);
  const [downloadingTrackId, setDownloadingTrackId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [offlinePlayback, setOfflinePlayback] = useState<{ pack: RoutePack; index: number } | null>(null);
  const [offlinePaused, setOfflinePaused] = useState(false);

  const liveSourceRef = useRef<LiveGeolocationSource | null>(null);
  const simSourceRef = useRef<SimulatedPositionSource | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  const { fix, mode, smoothedSpeedMps } = usePositionFix(positionSource, 1000);
  const topicsList = useMemo(() => [...selectedTopics], [selectedTopics]);
  const feed = useFeed(
    fix ? { lat: fix.lat, lon: fix.lon, headingDeg: fix.headingDeg, speedMps: fix.speedMps } : null,
    mode,
    topicsList,
    5000,
  );
  const speech = useMemo(() => createSpeechController(), []);

  function toggleTopic(topic: TopicId) {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  function handleToggleTripLog(enabled: boolean) {
    setTripLogEnabled(enabled, window.localStorage);
    setTripLogEnabledState(enabled);
  }

  function handleExportTripLogJson() {
    downloadTextFile("hereabouts-trip-log.json", tripLogToJson(tripLogEntries), "application/json");
  }

  function handleExportTripLogGeoJson() {
    downloadTextFile(
      "hereabouts-trip-log.geojson",
      JSON.stringify(tripLogToGeoJson(tripLogEntries), null, 2),
      "application/geo+json",
    );
  }

  function handleClearTripLog() {
    clearTripLog(window.localStorage);
    setTripLogEntries([]);
  }

  useEffect(() => {
    listRoutePacks()
      .then(setDownloadedPacks)
      .catch((err) => console.warn("failed to load downloaded route packs:", err));
  }, []);

  // Milestone 5 (PLAN.md §11): downloads a route pack for one of the sample
  // tracks — batch-generated stories, ready to store in IndexedDB and play
  // back with the network off. Never automatic; only ever user-initiated.
  async function handleDownloadPack(trackId: string) {
    const track = SAMPLE_TRACKS.find((t) => t.id === trackId);
    if (!track) return;

    setDownloadingTrackId(trackId);
    setDownloadError(null);
    try {
      const pack = await fetchRoutePack({ mode: track.mode, trackId: track.id });
      await saveRoutePack(pack);
      setDownloadedPacks((prev) => [...prev.filter((p) => p.packId !== pack.packId), pack]);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to download route pack");
    } finally {
      setDownloadingTrackId(null);
    }
  }

  async function handleDeletePack(packId: string) {
    await deleteRoutePack(packId);
    setDownloadedPacks((prev) => prev.filter((p) => p.packId !== packId));
    if (offlinePlayback?.pack.packId === packId) stopOfflinePlayback();
  }

  /**
   * Offline playback (PLAN.md §10/§11): plays a downloaded pack's stories
   * in route order, independent of GPS — the "excellent audio tour" mode
   * that survives the network (and, per §10, an iOS lock screen once
   * stitched into one continuous audio timeline; this is the sequential
   * side of that without the lock-screen-continuity piece yet).
   */
  function startOfflinePlayback(pack: RoutePack) {
    stopAll();
    setOfflinePaused(false);
    setOfflinePlayback({ pack, index: 0 });
  }

  function stopOfflinePlayback() {
    speech.cancel();
    setOfflinePlayback(null);
    setOfflinePaused(false);
  }

  useEffect(() => {
    if (!offlinePlayback) return;
    const { pack, index } = offlinePlayback;
    if (index >= pack.stories.length) {
      setOfflinePlayback(null);
      return;
    }
    const story = pack.stories[index]!;
    speech.speak(story.narration, () => {
      setOfflinePlayback((prev) => (prev ? { pack: prev.pack, index: prev.index + 1 } : prev));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlinePlayback?.pack.packId, offlinePlayback?.index]);

  function handleOfflinePlayPause() {
    if (offlinePaused) {
      speech.resume();
      setOfflinePaused(false);
    } else {
      speech.pause();
      setOfflinePaused(true);
    }
  }

  function handleOfflineSkip() {
    setOfflinePlayback((prev) => (prev ? { pack: prev.pack, index: prev.index + 1 } : prev));
  }

  function handleOfflineReplay() {
    if (!offlinePlayback) return;
    setOfflinePaused(false);
    speech.speak(offlinePlayback.pack.stories[offlinePlayback.index]!.narration, () => {
      setOfflinePlayback((prev) => (prev ? { pack: prev.pack, index: prev.index + 1 } : prev));
    });
  }

  // As soon as the feed surfaces a new unheard place: mark it current, kick
  // off Milestone 3 generation, and speak whatever narration is actually
  // ready to be spoken. Generation happens once per selected place — not on
  // every /feed poll — and never blocks "never go silent": if /story itself
  // is unreachable, this falls back to the raw excerpt exactly as M1/M2 did.
  useEffect(() => {
    const next = feed.places[0];
    if (!next || next.id === lastSpokenIdRef.current || !fix) return;

    lastSpokenIdRef.current = next.id;
    setCurrentPlace(next);
    setCurrentStory(null);
    setIsPaused(false);
    feed.markHeard(next.id);
    setStoryLoading(true);

    // Trip log (PLAN.md §13): records the place actually heard, not the
    // listener's live position — a clearer "what did I hear" map on export,
    // and a smaller privacy footprint than a continuous position trail.
    // No-ops silently if the trip log isn't enabled (tripLog.ts's own guard).
    const updatedLog = appendTripLogEntry(
      { placeId: next.id, title: next.title, heardAt: new Date().toISOString(), lat: next.lat, lon: next.lon },
      window.localStorage,
    );
    setTripLogEntries(updatedLog);

    let cancelled = false;
    (async () => {
      try {
        const story = await fetchStory({
          place: next,
          mode,
          lat: fix.lat,
          lon: fix.lon,
          headingDeg: fix.headingDeg,
        });
        if (cancelled) return;
        setCurrentStory(story);
        speech.speak(story.narration);
      } catch (err) {
        if (cancelled) return;
        console.warn("story generation unreachable, falling back to the raw excerpt:", err);
        speech.speak(next.summary);
      } finally {
        if (!cancelled) setStoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run whenever the feed's candidate list changes; markHeard/speech/mode/fix are read fresh, not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.places]);

  useEffect(() => {
    if (mode === "driving" && !localStorage.getItem(DRIVING_NOTICE_KEY)) {
      setShowDrivingNotice(true);
    }
  }, [mode]);

  function dismissDrivingNotice() {
    localStorage.setItem(DRIVING_NOTICE_KEY, "1");
    setShowDrivingNotice(false);
  }

  function stopAll() {
    liveSourceRef.current?.stop();
    simSourceRef.current?.stop();
    speech.cancel();
    lastSpokenIdRef.current = null;
    setCurrentPlace(null);
    setCurrentStory(null);
    setPositionSource(null);
    setRunning(false);
    setOfflinePlayback(null);
    setOfflinePaused(false);
  }

  function startLive() {
    stopAll();
    const source = new LiveGeolocationSource();
    liveSourceRef.current = source;
    source.start();
    setPositionSource(source);
    setRunning(true);
  }

  async function startSimulator() {
    stopAll();
    setTrackLoadError(null);
    const track = SAMPLE_TRACKS.find((t) => t.id === trackId);
    if (!track) return;

    try {
      const res = await fetch(`/tracks/${track.file}`);
      if (!res.ok) throw new Error(`Failed to load ${track.file}: ${res.status}`);
      const points = parseGpx(await res.text());

      const source = new SimulatedPositionSource({ playbackRate });
      source.loadTrack(points, () => {
        // Track finished: stop generating new fixes, but let any story
        // still playing finish rather than cutting it off.
        setRunning(false);
        setPositionSource(null);
      });
      simSourceRef.current = source;
      source.start();
      setPositionSource(source);
      setRunning(true);
    } catch (err) {
      setTrackLoadError(err instanceof Error ? err.message : "Failed to load track");
    }
  }

  function handleStart() {
    if (sourceKind === "live") {
      if (!LiveGeolocationSource.isSupported()) return;
      startLive();
    } else {
      void startSimulator();
    }
  }

  function handlePlayPause() {
    if (!currentPlace) return;
    if (isPaused) {
      speech.resume();
      setIsPaused(false);
    } else {
      speech.pause();
      setIsPaused(true);
    }
  }

  function handleReplay() {
    if (!currentPlace) return;
    setIsPaused(false);
    speech.speak(currentStory?.narration ?? currentPlace.summary);
  }

  function handleSkip() {
    speech.cancel();
    setCurrentPlace(null);
    setCurrentStory(null);
    // currentPlace's id is already marked heard; the next /feed poll
    // surfaces whatever candidate is next.
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Hereabouts</h1>
        <p className="app__tagline">Your friendly local guide, riding along.</p>
      </header>

      {showDrivingNotice && (
        <div className="app__notice" role="alert">
          🚗 Driving mode: this app is audio-first. Please have a passenger handle the screen.
          <button type="button" onClick={dismissDrivingNotice}>
            Got it
          </button>
        </div>
      )}

      <section className="app__controls-panel">
        <label>
          <input
            type="radio"
            name="source"
            checked={sourceKind === "simulator"}
            onChange={() => setSourceKind("simulator")}
            disabled={running}
          />
          Simulator (GPS replay)
        </label>
        <label>
          <input
            type="radio"
            name="source"
            checked={sourceKind === "live"}
            onChange={() => setSourceKind("live")}
            disabled={running}
          />
          Live GPS
        </label>

        {sourceKind === "simulator" && (
          <div className="app__simulator-options">
            <label>
              Track:
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value as TrackId)}
                disabled={running}
              >
                {SAMPLE_TRACKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Speed:
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
                disabled={running}
              >
                <option value={1}>1x</option>
                <option value={4}>4x</option>
                <option value={16}>16x</option>
              </select>
            </label>
          </div>
        )}

        {!running ? (
          <button type="button" onClick={handleStart}>
            Start
          </button>
        ) : (
          <button type="button" onClick={stopAll}>
            Stop
          </button>
        )}

        {trackLoadError && <p className="app__error">{trackLoadError}</p>}
        {sourceKind === "live" && !LiveGeolocationSource.isSupported() && (
          <p className="app__error">This browser doesn&apos;t support geolocation.</p>
        )}

        <div className="app__topic-filters">
          <span className="app__topic-filters-label">Prefer hearing about:</span>
          <TopicFilters selected={selectedTopics} onToggle={toggleTopic} />
        </div>
      </section>

      {running && (
        <section className="app__status">
          <span className="app__status-mode">{formatMode(mode)}</span>
          <span className="app__status-speed">{formatSpeed(smoothedSpeedMps)}</span>
          {feed.loading && <span className="app__status-loading">Checking for stories…</span>}
          {feed.error && <span className="app__error">{feed.error}</span>}
        </section>
      )}

      <main className="app__main">
        {offlinePlayback ? (
          <>
            <p className="app__offline-status">
              Offline playback — place {offlinePlayback.index + 1} of {offlinePlayback.pack.stories.length}
            </p>
            <TextCard
              place={offlinePlayback.pack.places[offlinePlayback.index]!}
              story={offlinePlayback.pack.stories[offlinePlayback.index]!}
              storyLoading={false}
              isPlaying={true}
              isPaused={offlinePaused}
              onPlayPause={handleOfflinePlayPause}
              onReplay={handleOfflineReplay}
              onSkip={handleOfflineSkip}
            />
            <button type="button" onClick={stopOfflinePlayback}>
              Stop offline playback
            </button>
          </>
        ) : (
          <>
            {running && (
              <Suspense fallback={<div className="map-view map-view--loading">Loading map…</div>}>
                <MapView position={fix ? { lat: fix.lat, lon: fix.lon } : null} places={feed.places} />
              </Suspense>
            )}

            {currentPlace ? (
              <TextCard
                place={currentPlace}
                story={currentStory}
                storyLoading={storyLoading}
                isPlaying={true}
                isPaused={isPaused}
                onPlayPause={handlePlayPause}
                onReplay={handleReplay}
                onSkip={handleSkip}
              />
            ) : (
              running && <p className="app__waiting">Nothing nearby yet — listening for stories…</p>
            )}
          </>
        )}
      </main>

      <RoutePackPanel
        tracks={SAMPLE_TRACKS}
        downloadedPacks={downloadedPacks}
        downloadingTrackId={downloadingTrackId}
        downloadError={downloadError}
        onDownload={(id) => void handleDownloadPack(id)}
        onPlayOffline={startOfflinePlayback}
        onDelete={(id) => void handleDeletePack(id)}
      />

      <TripLogPanel
        enabled={tripLogEnabled}
        onToggleEnabled={handleToggleTripLog}
        entries={tripLogEntries}
        onExportJson={handleExportTripLogJson}
        onExportGeoJson={handleExportTripLogGeoJson}
        onClear={handleClearTripLog}
      />
    </div>
  );
}
