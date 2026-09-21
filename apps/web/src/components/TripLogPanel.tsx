import type { TripLogEntry } from "../tripLog";

export interface TripLogPanelProps {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  entries: TripLogEntry[];
  onExportJson: () => void;
  onExportGeoJson: () => void;
  onClear: () => void;
}

/**
 * Milestone 4's trip log UI (PLAN.md §13): opt-in, with one-tap export in
 * both formats §13 names and a hard delete. See `tripLog.ts`'s doc comment
 * for the honest caveat this is client-local only for now — there's no
 * account/server layer yet to sync it across devices.
 */
export function TripLogPanel({ enabled, onToggleEnabled, entries, onExportJson, onExportGeoJson, onClear }: TripLogPanelProps) {
  return (
    <section className="trip-log">
      <label className="trip-log__consent">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggleEnabled(e.target.checked)} />
        Keep a trip log on this device
      </label>
      <p className="trip-log__note">
        Off by default. When on, each story you hear is recorded (title, time, location) in this
        browser only — never sent anywhere. Turn it off any time; export or delete what's recorded
        below.
      </p>

      {enabled && (
        <>
          <p className="trip-log__count">
            {entries.length === 0 ? "Nothing recorded yet." : `${entries.length} place${entries.length === 1 ? "" : "s"} recorded.`}
          </p>
          {entries.length > 0 && (
            <ul className="trip-log__entries">
              {entries
                .slice()
                .reverse()
                .map((entry) => (
                  <li key={`${entry.placeId}-${entry.heardAt}`}>
                    <span className="trip-log__entry-title">{entry.title}</span>
                    <span className="trip-log__entry-time">{new Date(entry.heardAt).toLocaleString()}</span>
                  </li>
                ))}
            </ul>
          )}
          <div className="trip-log__actions">
            <button type="button" onClick={onExportJson} disabled={entries.length === 0}>
              Export JSON
            </button>
            <button type="button" onClick={onExportGeoJson} disabled={entries.length === 0}>
              Export GeoJSON
            </button>
            <button type="button" onClick={onClear} disabled={entries.length === 0}>
              Delete trip log
            </button>
          </div>
        </>
      )}
    </section>
  );
}
