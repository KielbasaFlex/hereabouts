import type { PlaceEvent } from "@hereabouts/contracts";
import { parseGpx, type PositionSource } from "@hereabouts/core/sim";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { TextCard } from "./components/TextCard";
import { formatMode, formatSpeed } from "./format";
import { useFeed } from "./hooks/useFeed";
import { usePositionFix } from "./hooks/usePositionFix";
import { LiveGeolocationSource } from "./position/liveGeolocationSource";
import { SimulatedPositionSource } from "./position/simulatedSource";
import { createSpeechController } from "./speech";

type SourceKind = "live" | "simulator";

const SAMPLE_TRACKS = [
  { id: "downtown-walk", label: "Downtown walk", file: "downtown-walk.gpx" },
  { id: "coastal-bike", label: "Coastal bike ride", file: "coastal-bike.gpx" },
  { id: "highway-drive", label: "Highway drive", file: "highway-drive.gpx" },
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
  const [isPaused, setIsPaused] = useState(false);

  const liveSourceRef = useRef<LiveGeolocationSource | null>(null);
  const simSourceRef = useRef<SimulatedPositionSource | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  const { fix, mode, smoothedSpeedMps } = usePositionFix(positionSource, 1000);
  const feed = useFeed(
    fix ? { lat: fix.lat, lon: fix.lon, headingDeg: fix.headingDeg, speedMps: fix.speedMps } : null,
    mode,
    5000,
  );
  const speech = useMemo(() => createSpeechController(), []);

  // Speak the next unheard place as soon as the feed surfaces one.
  useEffect(() => {
    const next = feed.places[0];
    if (next && next.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = next.id;
      setCurrentPlace(next);
      setIsPaused(false);
      feed.markHeard(next.id);
      speech.speak(next.sourceExcerpt);
    }
    // Re-run whenever the feed's candidate list changes; markHeard/speech are stable.
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
    setPositionSource(null);
    setRunning(false);
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
    speech.speak(currentPlace.sourceExcerpt);
  }

  function handleSkip() {
    speech.cancel();
    setCurrentPlace(null);
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
        {currentPlace ? (
          <TextCard
            place={currentPlace}
            isPlaying={true}
            isPaused={isPaused}
            onPlayPause={handlePlayPause}
            onReplay={handleReplay}
            onSkip={handleSkip}
          />
        ) : (
          running && <p className="app__waiting">Nothing nearby yet — listening for stories…</p>
        )}
      </main>
    </div>
  );
}
