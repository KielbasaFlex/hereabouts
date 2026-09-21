import { ModeClassifier, type Mode } from "@hereabouts/core/mode";
import type { PositionFix, PositionSource } from "@hereabouts/core/sim";
import { useEffect, useMemo, useState } from "react";

export interface PositionState {
  fix: PositionFix | null;
  mode: Mode;
  smoothedSpeedMps: number;
}

const INITIAL_STATE: PositionState = { fix: null, mode: "stationary", smoothedSpeedMps: 0 };

/**
 * Polls a `PositionSource` on an interval and feeds its speed into a
 * `ModeClassifier` (packages/core/src/mode). A new classifier is created
 * whenever `source` changes identity, so switching between live GPS and the
 * simulator doesn't carry stale hysteresis/dwell state across the switch.
 */
export function usePositionFix(source: PositionSource | null, pollMs = 1000): PositionState {
  const classifier = useMemo(() => new ModeClassifier(), [source]);
  const [state, setState] = useState<PositionState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);
    if (!source) return undefined;

    const interval = setInterval(() => {
      const fix = source.current();
      if (!fix) return;
      const { mode, smoothedSpeedMps } = classifier.update(fix.speedMps, fix.timestampMs);
      setState({ fix, mode, smoothedSpeedMps });
    }, pollMs);

    return () => clearInterval(interval);
  }, [source, classifier, pollMs]);

  return state;
}
