import type { Db } from "@hereabouts/db";
import { subscriptions, tierLimits, usageEvents } from "@hereabouts/db";
import { eq } from "drizzle-orm";
import type { RateLimiter } from "./rateLimiter.js";

const SECONDS_PER_DAY = 86_400;

/** PLAN.md §12: "a global daily generation ceiling with alerting, so a scraper or a bug cannot run up an unbounded Claude/TTS bill overnight." */
const GLOBAL_DAILY_STORY_CEILING = 5000;

function todayKey(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC — a fixed daily window, not a rolling 24h one
  return `${prefix}:${date}`;
}

export interface UsageCheckOptions {
  rateLimiter: RateLimiter;
  db: Db;
  /** `null` for an anonymous/unauthenticated caller — still covered by the global ceiling, just not individually capped. */
  userId: string | null;
  kind: "story_generated";
}

export interface UsageCheckResult {
  allowed: boolean;
  reason?: "global_ceiling" | "daily_cap";
}

/**
 * PLAN.md §12's two-layer cost protection, checked before generation
 * actually runs:
 *
 * 1. **Global ceiling** — applies to every request, authenticated or not.
 *    This is the "a scraper or a bug can't run up an unbounded bill"
 *    safety net, and it's the only protection an anonymous caller has.
 * 2. **Per-user daily cap** — only for a logged-in user, read from their
 *    subscription's tier and that tier's `tier_limits` row (a `null` cap
 *    means unlimited, i.e. premium). A logged-in user without a
 *    `subscriptions` row yet is treated as `free`.
 *
 * A successful (allowed) check for a logged-in user also records a
 * `usage_events` row — the append-only meter PLAN.md §12 asks for.
 */
export async function checkAndRecordUsage(options: UsageCheckOptions): Promise<UsageCheckResult> {
  const globalCount = await options.rateLimiter.increment(todayKey(`global:${options.kind}`), SECONDS_PER_DAY);
  if (globalCount > GLOBAL_DAILY_STORY_CEILING) {
    return { allowed: false, reason: "global_ceiling" };
  }

  if (options.userId) {
    const [sub] = await options.db.select().from(subscriptions).where(eq(subscriptions.userId, options.userId));
    const tier = sub?.tier ?? "free";
    const [limits] = await options.db.select().from(tierLimits).where(eq(tierLimits.tier, tier));
    const cap = limits?.dailyStoryCap ?? null;

    if (cap !== null) {
      const userCount = await options.rateLimiter.increment(
        todayKey(`user:${options.userId}:${options.kind}`),
        SECONDS_PER_DAY,
      );
      if (userCount > cap) {
        return { allowed: false, reason: "daily_cap" };
      }
    }

    await options.db.insert(usageEvents).values({ userId: options.userId, kind: options.kind });
  }

  return { allowed: true };
}
