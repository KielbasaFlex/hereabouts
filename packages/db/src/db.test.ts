import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { oauthAccounts, sessions, subscriptions, tierLimits, usageEvents, users } from "./schema.js";

/**
 * Real integration tests against a real local Postgres — the first actual
 * database usage in this codebase (Milestone 6). `DATABASE_URL` must point
 * at an already-migrated database; see `README`/`PLAN.md`'s Milestone 6
 * section for how this session set one up (a natively-installed Postgres,
 * not Docker, since the sandbox has no Docker daemon). CI needs a real
 * Postgres service for this file to run — same requirement any
 * Postgres-backed app's test suite has, not new to this project.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts_test";

let db: Db;

beforeEach(async () => {
  db = createDb(TEST_DATABASE_URL);
  // Truncate rather than drop/recreate — migrations already ran once
  // against this database; tests just need a clean slate each time.
  await db.execute(
    sql`TRUNCATE TABLE usage_events, oauth_accounts, sessions, subscriptions, tier_limits, users RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  // postgres-js keeps the TCP connection open otherwise, hanging vitest.
  const client = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
  await client.end();
});

describe("users", () => {
  it("inserts a user with a generated id and default createdAt", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com", passwordHash: "hash" }).returning();
    expect(user?.id).toBeTruthy();
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it("enforces the unique email index", async () => {
    await db.insert(users).values({ email: "dup@example.com" });
    await expect(db.insert(users).values({ email: "dup@example.com" })).rejects.toThrow();
  });

  it("allows a null passwordHash for an OAuth-only account", async () => {
    const [user] = await db.insert(users).values({ email: "oauth@example.com" }).returning();
    expect(user?.passwordHash).toBeNull();
  });
});

describe("oauthAccounts", () => {
  it("links an OAuth identity to a user and cascades on user deletion", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    await db.insert(oauthAccounts).values({ userId: user!.id, provider: "google", providerAccountId: "g-123" });

    await db.delete(users).where(eq(users.id, user!.id));
    const remaining = await db.select().from(oauthAccounts);
    expect(remaining).toEqual([]);
  });

  it("enforces uniqueness per (provider, providerAccountId)", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    await db.insert(oauthAccounts).values({ userId: user!.id, provider: "google", providerAccountId: "g-123" });
    await expect(
      db.insert(oauthAccounts).values({ userId: user!.id, provider: "google", providerAccountId: "g-123" }),
    ).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("stores and retrieves a session by its token", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    const expiresAt = new Date(Date.now() + 60_000);
    await db.insert(sessions).values({ token: "tok_123", userId: user!.id, expiresAt });

    const [found] = await db.select().from(sessions).where(eq(sessions.token, "tok_123"));
    expect(found?.userId).toBe(user!.id);
  });

  it("cascades deletion when the owning user is deleted", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    await db.insert(sessions).values({ token: "tok_123", userId: user!.id, expiresAt: new Date() });
    await db.delete(users).where(eq(users.id, user!.id));
    expect(await db.select().from(sessions)).toEqual([]);
  });
});

describe("subscriptions", () => {
  it("defaults tier to free", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    const [sub] = await db
      .insert(subscriptions)
      .values({ userId: user!.id, stripeCustomerId: "cus_123", status: "active" })
      .returning();
    expect(sub?.tier).toBe("free");
  });

  it("upgrades to premium and reflects it on read", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    await db.insert(subscriptions).values({ userId: user!.id, stripeCustomerId: "cus_123", status: "active" });
    await db
      .update(subscriptions)
      .set({ tier: "premium", stripeSubscriptionId: "sub_123" })
      .where(eq(subscriptions.userId, user!.id));

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
    expect(sub?.tier).toBe("premium");
    expect(sub?.stripeSubscriptionId).toBe("sub_123");
  });
});

describe("tierLimits", () => {
  it("null dailyStoryCap means unlimited (premium's row)", async () => {
    await db.insert(tierLimits).values({ tier: "premium", dailyStoryCap: null, premiumVoices: true });
    const [row] = await db.select().from(tierLimits).where(eq(tierLimits.tier, "premium"));
    expect(row?.dailyStoryCap).toBeNull();
  });

  it("a real number caps the free tier", async () => {
    await db.insert(tierLimits).values({ tier: "free", dailyStoryCap: 20 });
    const [row] = await db.select().from(tierLimits).where(eq(tierLimits.tier, "free"));
    expect(row?.dailyStoryCap).toBe(20);
  });
});

describe("usageEvents", () => {
  it("records an append-only event per generation", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    await db.insert(usageEvents).values({ userId: user!.id, kind: "story_generated" });
    await db.insert(usageEvents).values({ userId: user!.id, kind: "story_generated" });

    const events = await db.select().from(usageEvents).where(eq(usageEvents.userId, user!.id));
    expect(events).toHaveLength(2);
  });

  it("counts today's events for a daily-cap check", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning();
    for (let i = 0; i < 3; i++) {
      await db.insert(usageEvents).values({ userId: user!.id, kind: "story_generated" });
    }
    const events = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.userId, user!.id));
    expect(events.filter((e) => e.kind === "story_generated")).toHaveLength(3);
  });
});
