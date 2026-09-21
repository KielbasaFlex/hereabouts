import type Stripe from "stripe";

/**
 * Stripe Billing (PLAN.md §12). `api.stripe.com` is blocked by this
 * environment's egress the same way every other paid-API host is — see
 * `fixtures/README.md` for what that means for verification here. The
 * Stripe SDK's request-building itself is exercised for real via injected
 * fakes matching the SDK's own real return shapes, and webhook signature
 * verification (`webhook.ts`) is tested with **real** cryptography, not a
 * mock, since Stripe ships a test-signature helper for exactly this.
 */

export interface CreateCheckoutSessionOptions {
  stripe: Pick<Stripe, "checkout">;
  /** Threaded through as Checkout's `client_reference_id` — how the webhook later links the session back to this user. */
  userId: string;
  customerEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

/** Starts a subscription Checkout session for the given price — returns the URL to redirect the browser to. */
export async function createCheckoutSession(options: CreateCheckoutSessionOptions): Promise<{ url: string }> {
  const session = await options.stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: options.userId,
    customer_email: options.customerEmail,
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}
