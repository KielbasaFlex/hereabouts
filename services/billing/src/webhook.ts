import type { Db } from "@hereabouts/db";
import { subscriptions } from "@hereabouts/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

/**
 * Verifies a webhook's `Stripe-Signature` header against the raw request
 * body using Stripe's own HMAC-SHA256 scheme — real cryptographic
 * verification (see `webhook.test.ts`), not a mock, and the one piece of
 * this billing integration verifiable end-to-end without a reachable
 * Stripe API. **Never parse the JSON body before this call**: the
 * signature covers the exact raw bytes Stripe sent, and a re-serialized
 * JSON.parse/stringify round trip can byte-for-byte differ enough to fail
 * verification even for a genuine event.
 */
export function verifyWebhookEvent(
  stripe: Pick<Stripe, "webhooks">,
  rawBody: string | Buffer,
  signatureHeader: string,
  webhookSecret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

/**
 * Mirrors a verified event into the `subscriptions` table (PLAN.md §4.6).
 * Unhandled event types are silently ignored — Stripe sends far more event
 * types than this app acts on, and ignoring the rest is the documented,
 * correct way to handle a webhook endpoint, not a gap.
 */
export async function applyWebhookEvent(db: Db, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (!userId || !session.customer) break; // nothing to link this session to

      const values = {
        userId,
        stripeCustomerId: String(session.customer),
        stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
        status: "active",
        tier: "premium",
        updatedAt: new Date(),
      };
      await db.insert(subscriptions).values(values).onConflictDoUpdate({ target: subscriptions.userId, set: values });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const tier = subscription.status === "active" || subscription.status === "trialing" ? "premium" : "free";
      await db
        .update(subscriptions)
        .set({
          status: subscription.status,
          tier,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
      break;
    }

    default:
      break;
  }
}
