import type { PlaceEvent } from "@hereabouts/contracts";
import { formatDistance } from "../format";

const LICENSE_LABELS: Record<PlaceEvent["license"], string> = {
  "cc-by-sa-4.0": "Wikipedia, CC BY-SA 4.0",
  "cc0": "CC0",
  "odbl-1.0": "© OpenStreetMap contributors, ODbL",
  "public-domain-usgov": "US Government, public domain",
};

export interface TextCardProps {
  place: PlaceEvent;
  isPlaying: boolean;
  isPaused: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
  onReplay: () => void;
}

/**
 * The text card (PLAN.md §9): title, distance, narration, source excerpt,
 * source link, license attribution, and playback controls.
 *
 * M1 reads the raw Wikipedia extract verbatim, so "narration" and "source
 * excerpt" are the same text — shown once here, not duplicated, with a note
 * that Milestone 3 is what turns this into scaled, grounded, non-mirroring
 * narration distinct from the excerpt it's drawn from.
 */
export function TextCard({ place, isPlaying, isPaused, onPlayPause, onSkip, onReplay }: TextCardProps) {
  return (
    <article className="text-card">
      <header>
        <h2>{place.title}</h2>
        <p className="text-card__distance">{formatDistance(place.distanceM)}</p>
      </header>

      <p className="text-card__narration">{place.sourceExcerpt}</p>
      <p className="text-card__narration-note">
        Raw source excerpt — grounded, length-scaled narration arrives in Milestone 3.
      </p>

      <footer>
        <a href={place.sourceUrl} target="_blank" rel="noreferrer" className="text-card__source-link">
          Read the source article
        </a>
        <p className="text-card__license">{LICENSE_LABELS[place.license]}</p>
      </footer>

      <div className="text-card__controls">
        <button type="button" onClick={onPlayPause}>
          {isPlaying && !isPaused ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={onReplay}>
          Replay
        </button>
        <button type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </article>
  );
}
