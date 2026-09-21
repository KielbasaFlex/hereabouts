import { EmailAlreadyRegisteredError, InvalidCredentialsError, login, signUp } from "@hereabouts/auth";
import { createCheckoutSession, createPortalSession, applyWebhookEvent, verifyWebhookEvent } from "@hereabouts/billing";
import { FeedRequest, RoutePackRequest, StoryRequest } from "@hereabouts/contracts";
import type { Db } from "@hereabouts/db";
import { subscriptions } from "@hereabouts/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type Stripe from "stripe";
import { buildFeed, type FeedDependencies } from "./feed.js";
import { buildMeResponse } from "./me.js";
import type { RateLimiter } from "./rateLimiter.js";
import { buildRoutePack, type RoutePackDependencies } from "./route-pack.js";
import { clearSessionCookie, getSessionUser, setSessionCookie } from "./session-cookie.js";
import { buildStoryForRequest, type StoryDependencies } from "./story.js";
import type { TtsProvider } from "@hereabouts/tts";
import type { AudioStorage } from "@hereabouts/tts";
import { checkAndRecordUsage } from "./usage.js";

export interface BillingDependencies {
  stripe: Pick<Stripe, "checkout" | "billingPortal" | "webhooks">;
  webhookSecret: string;
  premiumPriceId: string;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
}

export interface TtsDependencies {
  provider: TtsProvider;
  storage: AudioStorage;
  /** The voice id to use — a single premium voice for now, not a picker (see PLAN.md's Milestone 6 caveats). */
  voice: string;
}

export interface AppDependencies {
  db: Db;
  rateLimiter: RateLimiter;
  feed: FeedDependencies;
  story: StoryDependencies;
  routePack: RoutePackDependencies;
  billing: BillingDependencies;
  tts: TtsDependencies;
  /** The web app's origin, for a CORS policy that can actually carry credentialed (cookie) requests. */
  webOrigin: string;
}

/**
 * Builds the Hono app with its dependencies injected, so tests (and the
 * production `server.ts` entrypoint) both go through the same wiring —
 * only the dependencies (real vs. fixture-backed adapters, a real vs. fake
 * Anthropic/Stripe client, a real vs. in-memory rate limiter) differ.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // Milestone 6 introduces the first cookie this API sets — CORS now
  // needs `credentials: true` and a specific origin (never `*` with
  // credentials on, which would let any site ride a logged-in user's
  // cookie).
  app.use("/*", cors({ origin: deps.webOrigin, credentials: true }));

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

    const sessionUser = await getSessionUser(c, deps.db);
    const usage = await checkAndRecordUsage({
      rateLimiter: deps.rateLimiter,
      db: deps.db,
      userId: sessionUser?.id ?? null,
      kind: "story_generated",
    });
    if (!usage.allowed) {
      return c.json({ error: "usage_limit", reason: usage.reason }, 429);
    }

    try {
      const story = await buildStoryForRequest(parsed.data, deps.story);
      return c.json(story);
    } catch (error) {
      console.error("story request failed", error);
      return c.json({ error: "generation_error" }, 502);
    }
  });

  app.post("/route-pack", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RoutePackRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    }

    try {
      const pack = await buildRoutePack(parsed.data, deps.routePack);
      return c.json(pack);
    } catch (error) {
      console.error("route-pack request failed", error);
      return c.json({ error: "route_pack_error" }, 502);
    }
  });

  // --- Auth (Milestone 6) --------------------------------------------
  // See @hereabouts/auth's own doc comment for why this is a small
  // hand-rolled session system rather than Auth.js's own wire protocol.

  app.post("/auth/signup", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return c.json({ error: "invalid_request" }, 400);
    }
    try {
      const session = await signUp(deps.db, body.email, body.password);
      setSessionCookie(c, session);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        return c.json({ error: "email_already_registered" }, 409);
      }
      console.error("signup failed", error);
      return c.json({ error: "signup_error" }, 500);
    }
  });

  app.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return c.json({ error: "invalid_request" }, 400);
    }
    try {
      const session = await login(deps.db, body.email, body.password);
      setSessionCookie(c, session);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return c.json({ error: "invalid_credentials" }, 401);
      }
      console.error("login failed", error);
      return c.json({ error: "login_error" }, 500);
    }
  });

  app.post("/auth/logout", async (c) => {
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/me", async (c) => {
    const sessionUser = await getSessionUser(c, deps.db);
    return c.json(await buildMeResponse(deps.db, sessionUser));
  });

  // --- Billing (Milestone 6) -------------------------------------------

  app.post("/billing/checkout", async (c) => {
    const sessionUser = await getSessionUser(c, deps.db);
    if (!sessionUser) return c.json({ error: "unauthorized" }, 401);

    try {
      const result = await createCheckoutSession({
        stripe: deps.billing.stripe,
        userId: sessionUser.id,
        customerEmail: sessionUser.email,
        priceId: deps.billing.premiumPriceId,
        successUrl: deps.billing.successUrl,
        cancelUrl: deps.billing.cancelUrl,
      });
      return c.json(result);
    } catch (error) {
      console.error("checkout session creation failed", error);
      return c.json({ error: "checkout_error" }, 502);
    }
  });

  app.post("/billing/portal", async (c) => {
    const sessionUser = await getSessionUser(c, deps.db);
    if (!sessionUser) return c.json({ error: "unauthorized" }, 401);

    const [sub] = await deps.db.select().from(subscriptions).where(eq(subscriptions.userId, sessionUser.id));
    if (!sub) return c.json({ error: "no_subscription" }, 404);

    try {
      const result = await createPortalSession({
        stripe: deps.billing.stripe,
        customerId: sub.stripeCustomerId,
        returnUrl: deps.billing.portalReturnUrl,
      });
      return c.json(result);
    } catch (error) {
      console.error("portal session creation failed", error);
      return c.json({ error: "portal_error" }, 502);
    }
  });

  // Stripe's signature covers the exact raw request bytes — reading
  // `c.req.text()` (not `.json()`) is required for verification to work.
  app.post("/billing/webhook", async (c) => {
    const signature = c.req.header("stripe-signature");
    const rawBody = await c.req.text();
    if (!signature) return c.json({ error: "missing_signature" }, 400);

    let event: Stripe.Event;
    try {
      event = verifyWebhookEvent(deps.billing.stripe, rawBody, signature, deps.billing.webhookSecret);
    } catch (error) {
      console.warn("webhook signature verification failed", error);
      return c.json({ error: "invalid_signature" }, 400);
    }

    try {
      await applyWebhookEvent(deps.db, event);
      return c.json({ received: true });
    } catch (error) {
      console.error("webhook handling failed", error);
      return c.json({ error: "webhook_error" }, 500);
    }
  });

  // --- Premium TTS (Milestone 6) ----------------------------------------

  app.post("/tts", async (c) => {
    const sessionUser = await getSessionUser(c, deps.db);
    if (!sessionUser) return c.json({ error: "unauthorized" }, 401);

    const [sub] = await deps.db.select().from(subscriptions).where(eq(subscriptions.userId, sessionUser.id));
    if (sub?.tier !== "premium") {
      return c.json({ error: "premium_required" }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || body.text.length === 0) {
      return c.json({ error: "invalid_request" }, 400);
    }

    try {
      const key = `${sessionUser.id}-${Buffer.from(body.text).toString("base64url").slice(0, 48)}.mp3`;
      const cached = await deps.tts.storage.get(key);
      if (cached) return c.json({ url: `/audio/${key}` });

      const { audioBytes, contentType } = await deps.tts.provider.synthesize({ text: body.text, voice: deps.tts.voice });
      const { url } = await deps.tts.storage.put(key, audioBytes, contentType);
      return c.json({ url });
    } catch (error) {
      console.error("tts synthesis failed", error);
      return c.json({ error: "tts_error" }, 502);
    }
  });

  // Serves whatever `/tts` stored — `LocalFileAudioStorage`'s dev-only
  // stand-in for a real object-storage CDN URL (see @hereabouts/tts's doc
  // comment). A real deployment would point `/tts`'s returned `url`
  // straight at the bucket instead of round-tripping through this API.
  app.get("/audio/:key", async (c) => {
    const key = c.req.param("key");
    const audio = await deps.tts.storage.get(key);
    if (!audio) return c.json({ error: "not_found" }, 404);
    return new Response(audio.bytes, { headers: { "Content-Type": audio.contentType } });
  });

  return app;
}
