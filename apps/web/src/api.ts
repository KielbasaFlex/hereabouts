import { FeedRequest, FeedResponse, Story, StoryRequest } from "@hereabouts/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** Calls `POST /feed` and validates the response shape before returning it. */
export async function fetchFeed(request: FeedRequest, signal?: AbortSignal): Promise<FeedResponse> {
  const validatedRequest = FeedRequest.parse(request);

  const response = await fetch(`${API_BASE_URL}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validatedRequest),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
  }

  return FeedResponse.parse(await response.json());
}

/**
 * Calls `POST /story` — generation is comparatively slow (an LLM call on a
 * cache miss), so this is invoked once per place actually selected for
 * playback, not on every `/feed` poll. See
 * `packages/contracts/src/story-request.ts`'s doc comment.
 */
export async function fetchStory(request: StoryRequest, signal?: AbortSignal): Promise<Story> {
  const validatedRequest = StoryRequest.parse(request);

  const response = await fetch(`${API_BASE_URL}/story`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validatedRequest),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Story request failed: ${response.status} ${response.statusText}`);
  }

  return Story.parse(await response.json());
}
