import type { RoutePack } from "@hereabouts/contracts";
import type { Mode } from "@hereabouts/core";

export interface RoutePackTrackOption {
  id: string;
  label: string;
  mode: Mode;
}

export interface RoutePackPanelProps {
  tracks: readonly RoutePackTrackOption[];
  downloadedPacks: RoutePack[];
  downloadingTrackId: string | null;
  downloadError: string | null;
  onDownload: (trackId: string) => void;
  onPlayOffline: (pack: RoutePack) => void;
  onDelete: (packId: string) => void;
}

/**
 * Milestone 5's route-pack UI (PLAN.md §11): download one of the sample
 * tracks as an offline pack (batch-generated stories, stored in
 * IndexedDB — see `offlineStore.ts`), then play any downloaded pack back
 * in route order with the network off. A live destination-based download
 * (via the OSRM adapter) isn't wired into this panel — see the Milestone 5
 * caveats in `PLAN.md` for why the sample-track path is what's verified
 * end-to-end in this environment.
 */
export function RoutePackPanel({
  tracks,
  downloadedPacks,
  downloadingTrackId,
  downloadError,
  onDownload,
  onPlayOffline,
  onDelete,
}: RoutePackPanelProps) {
  return (
    <section className="route-pack-panel">
      <h2 className="route-pack-panel__heading">Offline route packs</h2>
      <p className="route-pack-panel__note">
        Download a sample route ahead of time to play it back fully offline — text and audio, no
        network needed once it's downloaded.
      </p>

      <div className="route-pack-panel__downloads">
        {tracks.map((track) => (
          <button
            key={track.id}
            type="button"
            disabled={downloadingTrackId !== null}
            onClick={() => onDownload(track.id)}
          >
            {downloadingTrackId === track.id ? "Downloading…" : `Download "${track.label}"`}
          </button>
        ))}
      </div>

      {downloadError && <p className="app__error">{downloadError}</p>}

      {downloadedPacks.length > 0 && (
        <ul className="route-pack-panel__packs">
          {downloadedPacks.map((pack) => (
            <li key={pack.packId}>
              <span className="route-pack-panel__pack-summary">
                {pack.mode} · {pack.stories.length} place{pack.stories.length === 1 ? "" : "s"} ·{" "}
                {(pack.route.distanceM / 1000).toFixed(1)} km
              </span>
              <div className="route-pack-panel__pack-actions">
                <button type="button" onClick={() => onPlayOffline(pack)} disabled={pack.stories.length === 0}>
                  Play offline
                </button>
                <button type="button" onClick={() => onDelete(pack.packId)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
