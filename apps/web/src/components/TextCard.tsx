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
 * The text card (PLAN.md §9): title, distance, narration, an expandable
 * source excerpt, source link, license attribution, and playback controls.
 *
 * `summary` (spoken and shown as the primary narration) and `sourceExcerpt`
 * (the grounding substrate, shown verbatim) are the same text for a normal
 * point-level place — adapters read raw extracts, unmodified, until
 * Milestone 3's storytelling pipeline generates real narration from them.
 * They diverge for a gap-filler place (PLAN.md §7.6): `summary` carries the
 * honest "around this part of {settlement}" framing, while `sourceExcerpt`
 * stays the pure, unedited article extract. The source-excerpt block below
 * only renders when the two actually differ, so the common case isn't
 * cluttered with an identical repeat.
 */
export function TextCard({ place, isPlaying, isPaused, onPlayPause, onSkip, onReplay }: TextCardProps) {
  const hasDistinctExcerpt = place.sourceExcerpt !== place.summary;

  return (
    <article className="text-card">
      <header>
        <h2>{place.title}</h2>
        <p className="text-card__distance">{formatDistance(place.distanceM)}</p>
      </header>

      <p className="text-card__narration">{place.summary}</p>
      {!hasDistinctExcerpt && (
        <p className="text-card__narration-note">
          Raw source excerpt — grounded, length-scaled narration arrives in Milestone 3.
        </p>
      )}

      {hasDistinctExcerpt && (
        <details className="text-card__excerpt">
          <summary>Source excerpt</summary>
          <p>{place.sourceExcerpt}</p>
        </details>
      )}

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
