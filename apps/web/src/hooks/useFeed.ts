import type { FeedRequest, Mode, PlaceEvent } from "@hereabouts/contracts";
import { useEffect, useRef, useState } from "react";
import { fetchFeed } from "../api";

export interface FeedState {
  places: PlaceEvent[];
  error: string | null;
  loading: boolean;
  /** Marks a place as heard so future polls (server-side) exclude it. */
  markHeard: (id: string) => void;
}

export interface FeedFix {
  lat: number;
  lon: number;
  headingDeg: number;
  speedMps: number;
}

/**
 * Polls `POST /feed` while a position fix is available, tracking which
 * place ids this session has already heard so the feed doesn't repeat them
 * (a minimal version of PLAN.md §7's novelty rule — full ranking, a
 * prepared queue, and ahead-ness-based admission are Milestone 2).
 *
 * `topics` (Milestone 4) is a ranking *preference*, not a hard filter —
 * `packages/core/rank`'s `topicAffinity` still lets an unmatched place
 * compete, just at a lower weight, so an empty array here is simply "no
 * opinion," not "show nothing."
 */
export function useFeed(fix: FeedFix | null, mode: Mode, topics: readonly string[], pollMs = 5000): FeedState {
  const [places, setPlaces] = useState<PlaceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const heardIdsRef = useRef<Set<string>>(new Set());

  const { lat, lon, headingDeg, speedMps } = fix ?? {};
  const topicsKey = topics.join(",");

  useEffect(() => {
    if (lat === undefined || lon === undefined) return undefined;
    let cancelled = false;

    async function poll(): Promise<void> {
      setLoading(true);
      try {
        const request: FeedRequest = {
          lat: lat!,
          lon: lon!,
          headingDeg: headingDeg ?? 0,
          speedMps: speedMps ?? 0,
          mode,
          heardIds: [...heardIdsRef.current],
          topics: topicsKey === "" ? [] : topicsKey.split(","),
        };
        const response = await fetchFeed(request);
        if (!cancelled) {
          setPlaces(response.places);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "feed request failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // topicsKey (not topics) is the dep: a new array with the same contents
    // shouldn't restart the poll interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, headingDeg, speedMps, mode, topicsKey, pollMs]);

  return {
    places,
    error,
    loading,
    markHeard: (id: string) => heardIdsRef.current.add(id),
  };
}
