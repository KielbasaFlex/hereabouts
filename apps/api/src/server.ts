import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { fetchNearbyPlaces as fetchWikipedia, fetchArticleByTitle } from "@hereabouts/adapter-wikipedia";
import { fetchNearbyItems as fetchWikidata, fetchNearestSettlement } from "@hereabouts/adapter-wikidata";
import { fetchNearbyPlaces as fetchOverpass } from "@hereabouts/adapter-overpass";
import { queryNearby as fetchNrhp } from "@hereabouts/adapter-nrhp";
import { fetchRoute } from "@hereabouts/adapter-osrm";
import { createDb } from "@hereabouts/db";
import { parseGpx } from "@hereabouts/core/sim";
import { InMemoryStoryCache } from "@hereabouts/storytelling";
import { createOpenAiTtsProvider, LocalFileAudioStorage } from "@hereabouts/tts";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import Stripe from "stripe";
import { createApp } from "./app.js";
import { RedisRateLimiter } from "./rateLimiter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = join(__dirname, "../../../tracks");
const AUDIO_DIR = join(__dirname, "../data/audio");

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

const db = createDb(DATABASE_URL);
const redis = new Redis(REDIS_URL);
const rateLimiter = new RedisRateLimiter(redis);

// A real Stripe SDK client — never reachable in this environment (see
// SOURCES.md), but real request-building against the real SDK types.
// STRIPE_SECRET_KEY is unset in dev; the SDK accepts a placeholder string
// at construction time (it validates nothing until an actual API call).
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_unconfigured");

const ttsProvider = createOpenAiTtsProvider({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const audioStorage = new LocalFileAudioStorage(AUDIO_DIR);

const userAgent = process.env.HEREABOUTS_USER_AGENT ?? undefined;

// `new Anthropic()` reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from
// the environment on its own — nothing here should ever hold a literal key.
const anthropicClient = new Anthropic();

// One cache instance for the life of the process: this *is* the shared
// cache (PLAN.md §4.4/§8.4) every request reuses. Not persisted across
// restarts yet — see services/storytelling/src/cache.ts's doc comment.
const storyCache = new InMemoryStoryCache();

const feedDeps = {
  fetchWikipedia: (options) => fetchWikipedia({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchWikidata: (options) => fetchWikidata({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchOverpass: (options) => fetchOverpass({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchNrhp: (options) => fetchNrhp(options),
  fetchNearestSettlement: (options) => fetchNearestSettlement({ ...options, ...(userAgent ? { userAgent } : {}) }),
  fetchWikipediaArticle: (options) => fetchArticleByTitle({ ...options, ...(userAgent ? { userAgent } : {}) }),
} satisfies Parameters<typeof createApp>[0]["feed"];

const app = createApp({
  db,
  rateLimiter,
  webOrigin: WEB_ORIGIN,
  feed: feedDeps,
  story: {
    client: anthropicClient,
    cache: storyCache,
  },
  routePack: {
    feed: feedDeps,
    fetchRoute: (options) => fetchRoute(options),
    loadTrack: async (trackId) => {
      const xml = await readFile(join(TRACKS_DIR, `${trackId}.gpx`), "utf8");
      return parseGpx(xml);
    },
    client: anthropicClient,
    cache: storyCache,
  },
  billing: {
    stripe,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_unconfigured",
    premiumPriceId: process.env.STRIPE_PREMIUM_PRICE_ID ?? "price_unconfigured",
    successUrl: `${WEB_ORIGIN}/?checkout=success`,
    cancelUrl: `${WEB_ORIGIN}/?checkout=cancel`,
    portalReturnUrl: `${WEB_ORIGIN}/`,
  },
  tts: {
    provider: ttsProvider,
    storage: audioStorage,
    voice: "alloy",
  },
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`hereabouts-api listening on http://localhost:${info.port}`);
});
