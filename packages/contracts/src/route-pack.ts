import { z } from "zod";
import { Mode } from "./feed.js";
import { PlaceEvent } from "./place-event.js";
import { RouteLatLon, Route } from "./route.js";
import { Story } from "./story.js";

/**
 * A request to build an offline route pack (PLAN.md §11, Milestone 5).
 *
 * Two ways to get a route: a named sample GPX track (`trackId` — no live
 * routing call needed, and the only one verified end-to-end in this
 * environment; see `services/adapters/osrm/fixtures/README.md`), or a live
 * OSRM lookup between `origin`/`destination`. Exactly one of the two must
 * be given.
 */
export const RoutePackRequest = z
  .object({
    mode: Mode,
    trackId: z.string().min(1).optional(),
    origin: RouteLatLon.optional(),
    destination: RouteLatLon.optional(),
  })
  .refine(
    (req) => (req.trackId ? !req.origin && !req.destination : Boolean(req.origin && req.destination)),
    { message: "provide either trackId, or both origin and destination — not neither or both" },
  );
export type RoutePackRequest = z.infer<typeof RoutePackRequest>;

/** A slippy-map tile coordinate — see `packages/core/tiles`' doc comment on why this is coordinates, not tile bytes. */
export const TileCoord = z.object({
  z: z.number().int().min(0),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type TileCoord = z.infer<typeof TileCoord>;

/**
 * The offline pack itself (PLAN.md §11 step 5): route + the corridor's
 * places and their pre-generated stories + the tile list a PMTiles slice
 * would need + an attribution manifest, ready for IndexedDB storage and
 * fully offline playback (`apps/web`'s trip pack panel).
 *
 * No audio blobs yet — PLAN.md's step 4 ("pre-render premium TTS") needs a
 * paid TTS provider that doesn't exist until Milestone 6's billing lands;
 * offline playback today uses the same free-tier Web Speech API as live
 * playback, which needs no network once the app shell is cached.
 */
export const RoutePack = z.object({
  packId: z.string().min(1),
  mode: Mode,
  route: Route,
  places: z.array(PlaceEvent),
  stories: z.array(Story),
  tiles: z.array(TileCoord),
  attribution: z.array(z.string()),
  createdAt: z.string(),
});
export type RoutePack = z.infer<typeof RoutePack>;
