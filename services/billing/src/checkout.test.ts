import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "./checkout.js";

describe("createCheckoutSession", () => {
  it("returns the session URL on success", async () => {
    const create = vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_123" }));
    const stripe = { checkout: { sessions: { create } } } as unknown as Pick<Stripe, "checkout">;

    const result = await createCheckoutSession({
      stripe,
      userId: "user-1",
      customerEmail: "a@example.com",
      priceId: "price_123",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
  });

  it("passes client_reference_id so the webhook can later link the session to this user", async () => {
    interface CapturedParams {
      client_reference_id?: string;
      mode?: string;
      line_items?: { price: string; quantity: number }[];
    }
    const create = vi.fn(async (_params: CapturedParams) => ({ url: "https://checkout.stripe.com/c/pay/cs_test_123" }));
    const stripe = { checkout: { sessions: { create } } } as unknown as Pick<Stripe, "checkout">;

    await createCheckoutSession({
      stripe,
      userId: "user-42",
      customerEmail: "a@example.com",
      priceId: "price_123",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    });

    const params = create.mock.calls[0]![0];
    expect(params.client_reference_id).toBe("user-42");
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_123", quantity: 1 }]);
  });

  it("throws if Stripe doesn't return a URL", async () => {
    const create = vi.fn(async () => ({ url: null }));
    const stripe = { checkout: { sessions: { create } } } as unknown as Pick<Stripe, "checkout">;

    await expect(
      createCheckoutSession({
        stripe,
        userId: "user-1",
        customerEmail: "a@example.com",
        priceId: "price_123",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    ).rejects.toThrow(/did not return a checkout URL/);
  });
});
