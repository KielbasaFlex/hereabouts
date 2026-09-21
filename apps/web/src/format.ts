/**
 * Pure display-formatting helpers. Kept free of React/DOM so they're
 * testable without a browser environment.
 *
 * Deliberately distance-only, never directional ("on your left"): PLAN.md
 * §8.3 requires directional spatial language to be computed from a
 * validated `spatial_frame`, which doesn't exist until the Milestone 3
 * storytelling pipeline. Claiming a direction here would violate that rule
 * a milestone early.
 */

export function formatDistance(distanceM: number | undefined): string {
  if (distanceM === undefined || !Number.isFinite(distanceM)) return "distance unknown";
  if (distanceM < 1000) return `${Math.round(distanceM)} m away`;
  return `${(distanceM / 1000).toFixed(1)} km away`;
}

export function formatMode(mode: string): string {
  if (mode.length === 0) return mode;
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function formatSpeed(speedMps: number): string {
  const mph = speedMps * 2.23694;
  return `${mph.toFixed(1)} mph`;
}
