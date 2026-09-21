import { z } from "zod";
import { Mode } from "./feed.js";
import { PlaceEvent } from "./place-event.js";

/**
 * The `/story` request. Unlike `/feed` (polled every few seconds), `/story`
 * is called once per place actually selected for playback — generation is
 * comparatively slow and, once cached, should never be repeated for the
 * same place/length/prompt-version combination.
 *
 * The client sends the full `PlaceEvent` it already has from `/feed` rather
 * than just an id: there's still no persistence layer to look one up by id
 * from (PLAN.md's Milestone 2 caveats), so the API remains stateless
 * end-to-end, same as `/feed`.
 */
export const StoryRequest = z.object({
  place: PlaceEvent,
  mode: Mode,
  /** The listener's position/heading, for computing the spatial frame (PLAN.md §8.3). */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  headingDeg: z.number().min(0).max(360).default(0),
});
export type StoryRequest = z.infer<typeof StoryRequest>;
