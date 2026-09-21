import { angleDiffDeg, closestApproach, type LatLon } from "../geo/index.js";
import type { Mode } from "../mode/index.js";

/**
 * What kind of spatial language narration is allowed to use (PLAN.md §8.3):
 * "only say 'just ahead on your left' if it's computed from the user's
 * position and heading; otherwise use 'nearby' or 'about a mile from here.'"
 *
 * This is computed once, here, from real geometry, and threaded through
 * both the generation prompt (services/storytelling) and the deterministic
 * `checkSpatialLanguage` validator (`packages/core/grounding`) — the two
 * enforce the same rule from opposite ends, so a prompt that drifts still
 * gets caught.
 */
export type SpatialAllowance = "directional" | "proximal" | "regional";

export interface SpatialFrame {
  allow: SpatialAllowance;
  distanceM: number;
  /** Which side the place is on, only meaningful when `allow` is "directional". */
  side: "left" | "right" | "ahead" | "behind" | null;
}

/**
 * Within this distance *and* strongly aligned with the direction of travel,
 * a precise "on your left/right" claim is accurate enough to make. Tighter
 * for walking (where "your left" is unambiguous) than driving (where it
 * needs to hold for longer before the moment passes).
 */
const DIRECTIONAL_MAX_DISTANCE_M: Record<Mode, number> = {
  stationary: 50,
  walking: 50,
  biking: 100,
  driving: 150,
};

/** Below this, "nearby"/"just up ahead" is honest even without a precise side. */
const PROXIMAL_MAX_DISTANCE_M = 2000;

const ALIGNED_AHEADNESS_THRESHOLD = 0.3; // cos(~72°) — fairly generous, still directionally meaningful
const SIDE_SPLIT_DEG = 15; // within this many degrees of dead ahead/behind, call it "ahead"/"behind" rather than a side

/**
 * Computes the spatial frame for narrating `target` from `observer`'s
 * current position and heading. Callers building gap-filler (regional)
 * narration should not call this at all — construct `{ allow: "regional",
 * ... }` directly, since a gap-filler's "distance" is to a stand-in
 * settlement, not the thing actually being narrated, and running it through
 * this classifier could misleadingly call it "directional."
 */
export function computeSpatialFrame(
  observer: LatLon & { headingDeg: number },
  target: LatLon,
  mode: Mode,
): SpatialFrame {
  const { distanceM, aheadness, bearingDeg } = closestApproach(observer, observer.headingDeg, target);

  if (distanceM <= DIRECTIONAL_MAX_DISTANCE_M[mode] && Math.abs(aheadness) > ALIGNED_AHEADNESS_THRESHOLD) {
    const diff = angleDiffDeg(observer.headingDeg, bearingDeg);
    const side = diff > SIDE_SPLIT_DEG ? "right" : diff < -SIDE_SPLIT_DEG ? "left" : aheadness > 0 ? "ahead" : "behind";
    return { allow: "directional", distanceM, side };
  }

  if (distanceM <= PROXIMAL_MAX_DISTANCE_M) {
    return { allow: "proximal", distanceM, side: null };
  }

  return { allow: "regional", distanceM, side: null };
}
