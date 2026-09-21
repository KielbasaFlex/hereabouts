import type Anthropic from "@anthropic-ai/sdk";
import type { Story, StoryRequest } from "@hereabouts/contracts";
import { computeSpatialFrame, type SpatialFrame } from "@hereabouts/core";
import { buildStory, type StoryCache } from "@hereabouts/storytelling";

export interface StoryDependencies {
  client: Pick<Anthropic, "messages">;
  /**
   * The shared story cache (PLAN.md §4.4/§8.4) — a single instance passed
   * in by the caller (one per server process in `server.ts`) so every
   * request reuses it, which is the entire point of a *shared* cache.
   */
  cache: StoryCache;
}

/**
 * Resolves the `/story` request into a spatial frame and runs the
 * Milestone 3 pipeline. A gap-filler place (`place.isRegional`) forces
 * regional framing rather than computing one geometrically — see
 * `packages/contracts/src/place-event.ts`'s doc comment on `isRegional`
 * for why that distinction matters here specifically.
 */
export async function buildStoryForRequest(request: StoryRequest, deps: StoryDependencies): Promise<Story> {
  const spatialFrame: SpatialFrame = request.place.isRegional
    ? { allow: "regional", distanceM: request.place.distanceM ?? 0, side: null }
    : computeSpatialFrame(
        { lat: request.lat, lon: request.lon, headingDeg: request.headingDeg },
        { lat: request.place.lat, lon: request.place.lon },
        request.mode,
      );

  return buildStory({
    place: request.place,
    mode: request.mode,
    spatialFrame,
    cache: deps.cache,
    client: deps.client,
  });
}
