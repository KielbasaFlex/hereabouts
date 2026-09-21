import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createPortalSession } from "./portal.js";

describe("createPortalSession", () => {
  it("returns the portal session URL and passes the customer/return URL through", async () => {
    const create = vi.fn(async () => ({ url: "https://billing.stripe.com/p/session/abc" }));
    const stripe = { billingPortal: { sessions: { create } } } as unknown as Pick<Stripe, "billingPortal">;

    const result = await createPortalSession({
      stripe,
      customerId: "cus_123",
      returnUrl: "https://app.example.com/account",
    });

    expect(result.url).toBe("https://billing.stripe.com/p/session/abc");
    expect(create).toHaveBeenCalledWith({ customer: "cus_123", return_url: "https://app.example.com/account" });
  });
});
