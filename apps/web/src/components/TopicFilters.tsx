import { TOPIC_IDS, TOPIC_LABELS, type TopicId } from "@hereabouts/core/topics";

export interface TopicFiltersProps {
  selected: ReadonlySet<TopicId>;
  onToggle: (topic: TopicId) => void;
  disabled?: boolean;
}

/**
 * Milestone 4's topic filter UI: a row of toggle chips, one per
 * `@hereabouts/core/topics` vocabulary entry. Selecting one or more is a
 * ranking *preference* sent as `FeedRequest.topics` — `packages/core/rank`'s
 * `topicAffinity` still lets unmatched places compete at a lower weight, so
 * this never hides a place outright, and leaving nothing selected is
 * simply "no preference," not "show nothing."
 */
export function TopicFilters({ selected, onToggle, disabled }: TopicFiltersProps) {
  return (
    <div className="topic-filters" role="group" aria-label="Topic filters">
      {TOPIC_IDS.map((topic) => {
        const isSelected = selected.has(topic);
        return (
          <button
            key={topic}
            type="button"
            className={`topic-filters__chip${isSelected ? " topic-filters__chip--selected" : ""}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onToggle(topic)}
          >
            {TOPIC_LABELS[topic]}
          </button>
        );
      })}
    </div>
  );
}
