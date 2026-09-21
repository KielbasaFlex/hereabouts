import { FeedRequest, FeedResponse, RoutePack, RoutePackRequest, Story, StoryRequest } from "@hereabouts/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** Calls `POST /feed` and validates the response shape before returning it. */
export async function fetchFeed(request: FeedRequest, signal?: AbortSignal): Promise<FeedResponse> {
  const validatedRequest = FeedRequest.parse(request);

  const response = await fetch(`${API_BASE_URL}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(validatedRequest),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
  }

  return FeedResponse.parse(await response.json());
}

/** Thrown when `/story` returns 429 (Milestone 6's daily cap or global generation ceiling). */
export class StoryUsageLimitError extends Error {
  constructor(public readonly reason?: string) {
    super(`Story generation limit reached${reason ? ` (${reason})` : ""}`);
    this.name = "StoryUsageLimitError";
  }
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
    credentials: "include", // a logged-in caller's tier/usage cap (Milestone 6) is read from this session cookie
    body: JSON.stringify(validatedRequest),
    ...(signal ? { signal } : {}),
  });

  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as { reason?: string };
    throw new StoryUsageLimitError(body.reason);
  }
  if (!response.ok) {
    throw new Error(`Story request failed: ${response.status} ${response.statusText}`);
  }

  return Story.parse(await response.json());
}

/**
 * Calls `POST /route-pack` (Milestone 5, PLAN.md §11) — building a pack is
 * slow (a Batch API round trip across every place along the corridor), so
 * this is only called when the user explicitly asks to download a pack for
 * offline use, never automatically.
 */
export async function fetchRoutePack(request: RoutePackRequest, signal?: AbortSignal): Promise<RoutePack> {
  const validatedRequest = RoutePackRequest.parse(request);

  const response = await fetch(`${API_BASE_URL}/route-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(validatedRequest),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Route pack request failed: ${response.status} ${response.statusText}`);
  }

  return RoutePack.parse(await response.json());
}
