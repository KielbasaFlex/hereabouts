import { createDb, subscriptions, users, type Db } from "@hereabouts/db";
import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyWebhookEvent, verifyWebhookEvent } from "./webhook.js";

/**
 * `Stripe.webhooks.constructEvent`/`generateTestHeaderString` are pure,
 * local HMAC-SHA256 operations — no network call, no API key validation.
 * These tests exercise **real** signature verification, not a mock: a
 * genuinely wrong secret or tampered payload must be genuinely rejected.
 */
const stripe = new Stripe("sk_test_not_a_real_key");
const WEBHOOK_SECRET = "whsec_test_secret";

function signedRequest(event: unknown): { payload: string; signature: string } {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature };
}

describe("verifyWebhookEvent", () => {
  it("accepts a correctly signed payload", () => {
    const { payload, signature } = signedRequest({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
    const event = verifyWebhookEvent(stripe, payload, signature, WEBHOOK_SECRET);
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a payload signed with the wrong secret", () => {
    const { payload, signature } = signedRequest({ id: "evt_1", type: "checkout.session.completed" });
    expect(() => verifyWebhookEvent(stripe, payload, signature, "whsec_a_different_secret")).toThrow();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const { signature } = signedRequest({ id: "evt_1", type: "checkout.session.completed" });
    const tamperedPayload = JSON.stringify({ id: "evt_1", type: "customer.subscription.deleted" });
    expect(() => verifyWebhookEvent(stripe, tamperedPayload, signature, WEBHOOK_SECRET)).toThrow();
  });

  it("rejects a missing signature header", () => {
    const { payload } = signedRequest({ id: "evt_1", type: "checkout.session.completed" });
    expect(() => verifyWebhookEvent(stripe, payload, "", WEBHOOK_SECRET)).toThrow();
  });
});

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts_test";

let db: Db;

beforeEach(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`TRUNCATE TABLE subscriptions, users RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  const client = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
  await client.end();
});

function checkoutCompletedEvent(userId: string): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: userId, customer: "cus_123", subscription: "sub_123" } },
  } as unknown as Stripe.Event;
}

function subscriptionUpdatedEvent(subscriptionId: string, status: string, currentPeriodEnd: number): Stripe.Event {
  return {
    id: "evt_2",
    type: "customer.subscription.updated",
    data: { object: { id: subscriptionId, status, current_period_end: currentPeriodEnd } },
  } as unknown as Stripe.Event;
}

describe("applyWebhookEvent", () => {
  it("creates a premium subscription row on checkout.session.completed", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning({ id: users.id });

    await applyWebhookEvent(db, checkoutCompletedEvent(user!.id));

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
    expect(sub?.tier).toBe("premium");
    expect(sub?.status).toBe("active");
    expect(sub?.stripeCustomerId).toBe("cus_123");
    expect(sub?.stripeSubscriptionId).toBe("sub_123");
  });

  it("is idempotent — replaying the same event doesn't create a duplicate row", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning({ id: users.id });
    await applyWebhookEvent(db, checkoutCompletedEvent(user!.id));
    await applyWebhookEvent(db, checkoutCompletedEvent(user!.id));

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
    expect(rows).toHaveLength(1);
  });

  it("ignores a checkout event with no client_reference_id", async () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: null, customer: "cus_123" } },
    } as unknown as Stripe.Event;

    await applyWebhookEvent(db, event); // must not throw
    expect(await db.select().from(subscriptions)).toEqual([]);
  });

  it("downgrades to free when a subscription is canceled", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning({ id: users.id });
    await applyWebhookEvent(db, checkoutCompletedEvent(user!.id));

    const periodEnd = Math.floor(Date.now() / 1000) + 3600;
    await applyWebhookEvent(db, subscriptionUpdatedEvent("sub_123", "canceled", periodEnd));

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
    expect(sub?.tier).toBe("free");
    expect(sub?.status).toBe("canceled");
    expect(sub?.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
  });

  it("keeps premium while a subscription is active", async () => {
    const [user] = await db.insert(users).values({ email: "a@example.com" }).returning({ id: users.id });
    await applyWebhookEvent(db, checkoutCompletedEvent(user!.id));

    const periodEnd = Math.floor(Date.now() / 1000) + 3600;
    await applyWebhookEvent(db, subscriptionUpdatedEvent("sub_123", "active", periodEnd));

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
    expect(sub?.tier).toBe("premium");
  });

  it("ignores an event type this app doesn't act on", async () => {
    const event = { id: "evt_x", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event;
    await expect(applyWebhookEvent(db, event)).resolves.toBeUndefined();
  });
});
