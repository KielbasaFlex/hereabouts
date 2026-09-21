import type Stripe from "stripe";

export interface CreatePortalSessionOptions {
  stripe: Pick<Stripe, "billingPortal">;
  customerId: string;
  returnUrl: string;
}

/** Opens Stripe's hosted Customer Portal (manage/cancel a subscription, update payment method) for an existing customer. */
export async function createPortalSession(options: CreatePortalSessionOptions): Promise<{ url: string }> {
  const session = await options.stripe.billingPortal.sessions.create({
    customer: options.customerId,
    return_url: options.returnUrl,
  });
  return { url: session.url };
}
