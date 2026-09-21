import { useState } from "react";
import type { MeResponse } from "../account";

export interface AccountPanelProps {
  me: MeResponse | null;
  onSignUp: (email: string, password: string) => Promise<void>;
  onLogIn: (email: string, password: string) => Promise<void>;
  onLogOut: () => void;
  onUpgrade: () => void;
  onManageSubscription: () => void;
}

/**
 * Milestone 6's minimal account UI (PLAN.md §12): email+password sign
 * up/log in (see `@hereabouts/auth`'s doc comment for why this is a small
 * hand-rolled session system rather than Auth.js's own wire protocol —
 * social login isn't wired into this panel, only the server-side
 * URL-building/code-exchange functions exist so far), a tier/limits
 * summary, and an upgrade/manage-subscription button. Both billing
 * buttons redirect to a real Stripe-shaped URL from the API — they've
 * never completed a real Stripe flow in this environment (`api.stripe.com`
 * is blocked), which is disclosed rather than hidden.
 */
export function AccountPanel({ me, onSignUp, onLogIn, onLogOut, onUpgrade, onManageSubscription }: AccountPanelProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await onSignUp(email, password);
      else await onLogIn(email, password);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <section className="account-panel">Loading account…</section>;
  }

  if (me.user) {
    return (
      <section className="account-panel">
        <p className="account-panel__identity">
          Signed in as <strong>{me.user.email}</strong> — {me.tier} tier
          {me.tier === "premium" && me.subscriptionStatus ? ` (${me.subscriptionStatus})` : ""}
        </p>
        <p className="account-panel__limits">
          {me.limits.dailyStoryCap === null
            ? "Unlimited stories per day"
            : `${me.limits.dailyStoryCap} stories per day`}
          {me.limits.premiumVoices ? ", premium voices" : ""}
          {me.limits.routePacks ? ", offline route packs" : ""}
        </p>
        <div className="account-panel__actions">
          {me.tier === "premium" ? (
            <button type="button" onClick={onManageSubscription}>
              Manage subscription
            </button>
          ) : (
            <button type="button" onClick={onUpgrade}>
              Upgrade to Premium
            </button>
          )}
          <button type="button" onClick={onLogOut}>
            Log out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="account-panel">
      <form className="account-panel__form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="account-panel__mode-toggle">
          <button type="button" onClick={() => setMode("login")} disabled={mode === "login"}>
            Log in
          </button>
          <button type="button" onClick={() => setMode("signup")} disabled={mode === "signup"}>
            Sign up
          </button>
        </div>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <button type="submit" disabled={busy}>
          {mode === "signup" ? "Create account" : "Log in"}
        </button>
        {error && <p className="app__error">{error}</p>}
      </form>
      <p className="account-panel__note">Free tier: {me.limits.dailyStoryCap ?? "unlimited"} stories/day, no account needed.</p>
    </section>
  );
}
