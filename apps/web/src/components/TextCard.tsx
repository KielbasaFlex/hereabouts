import type { PlaceEvent, Story } from "@hereabouts/contracts";
import { buildHighlightedSegments } from "../citations";
import { formatDistance } from "../format";

const LICENSE_LABELS: Record<PlaceEvent["license"], string> = {
  "cc-by-sa-4.0": "Wikipedia, CC BY-SA 4.0",
  "cc0": "CC0",
  "odbl-1.0": "© OpenStreetMap contributors, ODbL",
  "public-domain-usgov": "US Government, public domain",
};

export interface TextCardProps {
  place: PlaceEvent;
  /** The Milestone 3 generated narration, once `/story` resolves. Null while loading or if it failed. */
  story: Story | null;
  storyLoading: boolean;
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
 * The primary narration is the Milestone 3 generated story once it's ready
 * (`story.narration`); until then, or if generation failed entirely, it
 * falls back to the place's raw `summary` — the same M1/M2 behavior,
 * so playback is never blocked on generation succeeding. The source-excerpt
 * block only renders when it actually differs from what's being narrated,
 * so a fallback-to-raw-excerpt case isn't shown twice.
 */
export function TextCard({
  place,
  story,
  storyLoading,
  isPlaying,
  isPaused,
  onPlayPause,
  onSkip,
  onReplay,
}: TextCardProps) {
  const narrationText = story?.narration ?? place.summary;
  // The template-fallback narration already *is* the source excerpt
  // (prefixed with the title) — showing the excerpt again in its own
  // section would just repeat the same text twice.
  const hasDistinctExcerpt =
    story?.validationStatus !== "template_fallback" && place.sourceExcerpt !== narrationText;

  return (
    <article className="text-card">
      <header>
        <h2>{place.title}</h2>
        <p className="text-card__distance">{formatDistance(place.distanceM)}</p>
      </header>

      <p className="text-card__narration">{narrationText}</p>

      {storyLoading && <p className="text-card__narration-note">Generating narration…</p>}
      {!storyLoading && !story && (
        <p className="text-card__narration-note">
          Raw source excerpt — grounded, length-scaled narration arrives once generation completes.
        </p>
      )}
      {!storyLoading && story?.validationStatus === "template_fallback" && (
        <p className="text-card__narration-note">
          Generated narration didn't pass grounding — showing the source excerpt directly instead.
        </p>
      )}
      {!storyLoading && story?.validationStatus === "validated" && story.citations.length > 0 && (
        <p className="text-card__citation-count">
          {story.citations.length} cited passage{story.citations.length === 1 ? "" : "s"} from the source
        </p>
      )}

      {hasDistinctExcerpt && (
        <details className="text-card__excerpt">
          <summary>Source excerpt</summary>
          <p>
            {buildHighlightedSegments(place.sourceExcerpt, story?.citations ?? []).map((segment, i) =>
              segment.cited ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>,
            )}
          </p>
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
