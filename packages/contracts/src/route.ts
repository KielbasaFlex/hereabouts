import { z } from "zod";

/**
 * A route polyline plus its total distance/duration (Milestone 5, PLAN.md
 * §11). Deliberately source-agnostic — `points` can come from a live OSRM
 * lookup (`services/adapters/osrm`) or from parsing one of `tracks/*.gpx`'s
 * sample tracks; nothing downstream (`packages/core/corridor`, the route
 * pack itself) needs to know which.
 */
export const RouteLatLon = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type RouteLatLon = z.infer<typeof RouteLatLon>;

export const Route = z.object({
  points: z.array(RouteLatLon).min(1),
  distanceM: z.number().min(0),
  durationS: z.number().min(0),
});
export type Route = z.infer<typeof Route>;
