import { createDb, subscriptions, tierLimits, usageEvents, users, type Db } from "@hereabouts/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./rateLimiter.js";
import { checkAndRecordUsage } from "./usage.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts_test";

let db: Db;

beforeEach(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`TRUNCATE TABLE usage_events, subscriptions, tier_limits, users RESTART IDENTITY CASCADE`);
  await db.insert(tierLimits).values([
    { tier: "free", dailyStoryCap: 3, premiumVoices: false, routePacks: false, tripLog: true },
    { tier: "premium", dailyStoryCap: null, premiumVoices: true, routePacks: true, tripLog: true },
  ]);
});

afterAll(async () => {
  const client = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
  await client.end();
});

async function makeUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  return user!.id;
}

describe("checkAndRecordUsage — anonymous callers", () => {
  it("allows an anonymous request and never records a usage_events row for it", async () => {
    const result = await checkAndRecordUsage({
      rateLimiter: new InMemoryRateLimiter(),
      db,
      userId: null,
      kind: "story_generated",
    });
    expect(result.allowed).toBe(true);
    expect(await db.select().from(usageEvents)).toEqual([]);
  });

  it("still enforces the global ceiling for anonymous callers", async () => {
    const rateLimiter = new InMemoryRateLimiter();
    // Pre-fill today's global counter past the ceiling by calling many times quickly.
    for (let i = 0; i < 5000; i++) {
      await checkAndRecordUsage({ rateLimiter, db, userId: null, kind: "story_generated" });
    }
    const result = await checkAndRecordUsage({ rateLimiter, db, userId: null, kind: "story_generated" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global_ceiling");
  });
});

describe("checkAndRecordUsage — free tier", () => {
  it("allows requests up to the free tier's daily cap and records a usage event each time", async () => {
    const userId = await makeUser("free@example.com");
    await db.insert(subscriptions).values({ userId, stripeCustomerId: "cus_x", status: "active", tier: "free" });
    const rateLimiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      const result = await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
      expect(result.allowed).toBe(true);
    }
    const events = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
    expect(events).toHaveLength(3);
  });

  it("rejects the request once the daily cap is exceeded", async () => {
    const userId = await makeUser("free@example.com");
    await db.insert(subscriptions).values({ userId, stripeCustomerId: "cus_x", status: "active", tier: "free" });
    const rateLimiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
    }
    const result = await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_cap");
  });

  it("treats a logged-in user with no subscription row yet as free", async () => {
    const userId = await makeUser("no-sub@example.com"); // no subscriptions row inserted
    const rateLimiter = new InMemoryRateLimiter();

    for (let i = 0; i < 3; i++) {
      const result = await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
      expect(result.allowed).toBe(true);
    }
    const result = await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_cap");
  });
});

describe("checkAndRecordUsage — premium tier", () => {
  it("never hits a daily cap (null cap means unlimited)", async () => {
    const userId = await makeUser("premium@example.com");
    await db.insert(subscriptions).values({ userId, stripeCustomerId: "cus_y", status: "active", tier: "premium" });
    const rateLimiter = new InMemoryRateLimiter();

    for (let i = 0; i < 10; i++) {
      const result = await checkAndRecordUsage({ rateLimiter, db, userId, kind: "story_generated" });
      expect(result.allowed).toBe(true);
    }
    const events = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
    expect(events).toHaveLength(10);
  });
});
