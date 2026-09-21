/**
 * Milestone 6 account/billing client calls. `credentials: "include"` is
 * required on every one of these — session auth is a cookie, and without
 * this the browser won't send (or accept) it, same-origin dev proxy or not.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export interface MeResponse {
  user: { id: string; email: string; name: string | null } | null;
  tier: "free" | "premium";
  subscriptionStatus: string | null;
  limits: { dailyStoryCap: number | null; premiumVoices: boolean; routePacks: boolean; tripLog: boolean };
}

export class AccountApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

export async function fetchMe(): Promise<MeResponse> {
  const response = await fetch(`${API_BASE_URL}/me`, { credentials: "include" });
  if (!response.ok) throw new AccountApiError(`/me failed: ${response.status}`, response.status);
  return response.json();
}

export async function signUp(email: string, password: string): Promise<void> {
  const response = await postJson("/auth/signup", { email, password });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "signup_error" }));
    throw new AccountApiError(body.error ?? "signup_error", response.status);
  }
}

export async function login(email: string, password: string): Promise<void> {
  const response = await postJson("/auth/login", { email, password });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "login_error" }));
    throw new AccountApiError(body.error ?? "login_error", response.status);
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

/** Starts a Stripe Checkout session and returns the URL to redirect the browser to. */
export async function startCheckout(): Promise<string> {
  const response = await postJson("/billing/checkout", {});
  if (!response.ok) throw new AccountApiError("checkout_error", response.status);
  const body = (await response.json()) as { url: string };
  return body.url;
}

/** Opens Stripe's hosted Customer Portal for an existing subscriber. */
export async function startPortal(): Promise<string> {
  const response = await postJson("/billing/portal", {});
  if (!response.ok) throw new AccountApiError("portal_error", response.status);
  const body = (await response.json()) as { url: string };
  return body.url;
}
