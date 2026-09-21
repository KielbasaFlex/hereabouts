import type { SessionUser } from "@hereabouts/auth";
import type { Db } from "@hereabouts/db";
import { subscriptions, tierLimits } from "@hereabouts/db";
import { eq } from "drizzle-orm";

export interface MeResponse {
  user: { id: string; email: string; name: string | null } | null;
  tier: "free" | "premium";
  subscriptionStatus: string | null;
  limits: { dailyStoryCap: number | null; premiumVoices: boolean; routePacks: boolean; tripLog: boolean };
}

const FALLBACK_LIMITS = { dailyStoryCap: null, premiumVoices: false, routePacks: false, tripLog: false };

/**
 * `GET /me` (PLAN.md §12's listed API surface): the caller's identity (if
 * any), tier, and that tier's current limits — everything the web client
 * needs to gate premium UI and show usage state, in one call. An
 * anonymous caller (no session cookie) still gets real `free`-tier limits
 * back, not a 401 — free-tier usage doesn't require an account.
 */
export async function buildMeResponse(db: Db, user: SessionUser | null): Promise<MeResponse> {
  if (!user) {
    const [freeLimits] = await db.select().from(tierLimits).where(eq(tierLimits.tier, "free"));
    return { user: null, tier: "free", subscriptionStatus: null, limits: freeLimits ?? FALLBACK_LIMITS };
  }

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const tier = sub?.tier === "premium" ? "premium" : "free";
  const [limits] = await db.select().from(tierLimits).where(eq(tierLimits.tier, tier));

  return {
    user: { id: user.id, email: user.email, name: user.name },
    tier,
    subscriptionStatus: sub?.status ?? null,
    limits: limits ?? FALLBACK_LIMITS,
  };
}
