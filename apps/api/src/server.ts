import Anthropic from "@anthropic-ai/sdk";
import { fetchNearbyPlaces as fetchWikipedia, fetchArticleByTitle } from "@hereabouts/adapter-wikipedia";
import { fetchNearbyItems as fetchWikidata, fetchNearestSettlement } from "@hereabouts/adapter-wikidata";
import { fetchNearbyPlaces as fetchOverpass } from "@hereabouts/adapter-overpass";
import { queryNearby as fetchNrhp } from "@hereabouts/adapter-nrhp";
import { InMemoryStoryCache } from "@hereabouts/storytelling";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const userAgent = process.env.HEREABOUTS_USER_AGENT ?? undefined;

// `new Anthropic()` reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from
// the environment on its own — nothing here should ever hold a literal key.
const anthropicClient = new Anthropic();

// One cache instance for the life of the process: this *is* the shared
// cache (PLAN.md §4.4/§8.4) every request reuses. Not persisted across
// restarts yet — see services/storytelling/src/cache.ts's doc comment.
const storyCache = new InMemoryStoryCache();

const app = createApp({
  feed: {
    fetchWikipedia: (options) => fetchWikipedia({ ...options, ...(userAgent ? { userAgent } : {}) }),
    fetchWikidata: (options) => fetchWikidata({ ...options, ...(userAgent ? { userAgent } : {}) }),
    fetchOverpass: (options) => fetchOverpass({ ...options, ...(userAgent ? { userAgent } : {}) }),
    fetchNrhp: (options) => fetchNrhp(options),
    fetchNearestSettlement: (options) => fetchNearestSettlement({ ...options, ...(userAgent ? { userAgent } : {}) }),
    fetchWikipediaArticle: (options) => fetchArticleByTitle({ ...options, ...(userAgent ? { userAgent } : {}) }),
  },
  story: {
    client: anthropicClient,
    cache: storyCache,
  },
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`hereabouts-api listening on http://localhost:${info.port}`);
});
