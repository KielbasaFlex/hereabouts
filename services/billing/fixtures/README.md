# Verification status

**`api.stripe.com` is blocked by this environment's egress proxy** — same
403-at-CONNECT treatment as every other paid-API host tried this session
(OpenAI, ElevenLabs). `createCheckoutSession` and `createPortalSession` are
unit-tested against injected fakes matching the real `stripe` npm SDK's
own TypeScript types (so a real API response is structurally guaranteed to
satisfy what these functions expect — the SDK's own type-checking is the
confidence anchor here, not a hand-maintained fixture), but neither has
ever completed a real request to Stripe.

**`webhook.ts`'s signature verification is different: it's tested for
real, not mocked.** Stripe's webhook signing scheme (`Stripe-Signature:
t=<timestamp>,v1=<hmac-sha256 hex>`) is a public, documented HMAC
construction, and the `stripe` SDK ships `webhooks.generateTestHeaderString`
specifically to construct a real, correctly-signed test header without a
network call. `webhook.test.ts` uses it to prove: a correctly-signed
payload is accepted, a payload signed with the wrong secret is rejected, a
tampered payload is rejected, and a missing signature is rejected — actual
cryptographic verification, not an assumption about what
`constructEvent` would do.

**Before this is considered done**, with real Stripe API keys and a
registered webhook endpoint:

1. Complete a real Checkout session end-to-end and confirm the returned
   `url` is a real `checkout.stripe.com` link that completes a test-mode
   card payment.
2. Point a real webhook endpoint at `apps/api`'s `/billing/webhook` route
   (once wired) and confirm Stripe's own webhook signing (not
   `generateTestHeaderString`) verifies correctly against the same
   `verifyWebhookEvent` code path.
3. Confirm the Customer Portal session's `url` opens a real portal for a
   real test-mode customer.

No price ids, customer ids, or webhook secrets in this package's tests are
real Stripe objects — all placeholders.
