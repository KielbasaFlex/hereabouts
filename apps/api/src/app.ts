import { FeedRequest, StoryRequest } from "@hereabouts/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildFeed, type FeedDependencies } from "./feed.js";
import { buildStoryForRequest, type StoryDependencies } from "./story.js";

export interface AppDependencies {
  feed: FeedDependencies;
  story: StoryDependencies;
}

/**
 * Builds the Hono app with its dependencies injected, so tests (and the
 * production `server.ts` entrypoint) both go through the same wiring —
 * only the dependencies (real vs. fixture-backed adapters, a real vs. fake
 * Anthropic client) differ.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // Permissive for now: the web app runs on a different origin in dev
  // (Vite) and this API has no cookies/auth yet to protect (Milestone 6).
  app.use("/*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/feed", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FeedRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }

    try {
      const response = await buildFeed(parsed.data, deps.feed);
      return c.json(response);
    } catch (error) {
      console.error("feed request failed", error);
      return c.json({ error: "upstream_error" }, 502);
    }
  });

  app.post("/story", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = StoryRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }

    try {
      const story = await buildStoryForRequest(parsed.data, deps.story);
      return c.json(story);
    } catch (error) {
      console.error("story request failed", error);
      return c.json({ error: "generation_error" }, 502);
    }
  });

  return app;
}
