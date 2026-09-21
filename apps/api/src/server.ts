import { fetchNearbyPlaces, HEREABOUTS_USER_AGENT } from "@hereabouts/adapter-wikipedia";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const userAgent = process.env.HEREABOUTS_USER_AGENT ?? HEREABOUTS_USER_AGENT;

const app = createApp({
  fetchNearby: (options) => fetchNearbyPlaces({ ...options, userAgent }),
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`hereabouts-api listening on http://localhost:${info.port}`);
});
