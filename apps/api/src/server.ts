import { fetchNearbyPlaces as fetchWikipedia, fetchArticleByTitle } from "@hereabouts/adapter-wikipedia";
import { fetchNearbyItems as fetchWikidata, fetchNearestSettlement } from "@hereabouts/adapter-wikidata";
import { fetchNearbyPlaces as fetchOverpass } from "@hereabouts/adapter-overpass";
import { queryNearby as fetchNrhp } from "@hereabouts/adapter-nrhp";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const userAgent = process.env.HEREABOUTS_USER_AGENT ?? undefined;

const app = createApp({
  fetchWikipedia: (options) => fetchWikipedia({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchWikidata: (options) => fetchWikidata({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchOverpass: (options) => fetchOverpass({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchNrhp: (options) => fetchNrhp(options),
  fetchNearestSettlement: (options) => fetchNearestSettlement({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchWikipediaArticle: (options) => fetchArticleByTitle({ ...options, ...(userAgent ? { userAgent } : {}) }),
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`hereabouts-api listening on http://localhost:${info.port}`);
});
