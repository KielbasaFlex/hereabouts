/**
 * Google OAuth2/OIDC (PLAN.md §12 "email + social"). Endpoints and shapes
 * are Google's own long-stable, publicly documented OAuth2/OIDC surface —
 * see `fixtures/README.md` for exactly what's unverified in this
 * environment (a real registered OAuth client and a reachable browser
 * redirect, neither of which exist here) versus what's just standard,
 * well-documented request/response shape.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Builds the URL to redirect the browser to for Google's consent screen. `state` is an opaque, caller-generated CSRF token. */
export function buildGoogleAuthorizeUrl(config: Pick<GoogleOAuthConfig, "clientId" | "redirectUri">, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface GoogleProfile {
  providerAccountId: string;
  email: string;
  name: string | null;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token: string;
}

interface GoogleUserinfoResponse {
  sub: string;
  email: string;
  name?: string;
}

export interface ExchangeGoogleCodeOptions {
  code: string;
  config: GoogleOAuthConfig;
  fetchImpl?: typeof fetch;
}

/** Exchanges an authorization code for tokens, then fetches the profile — the standard two-step OAuth2/OIDC code exchange. */
export async function exchangeGoogleCode(options: ExchangeGoogleCodeOptions): Promise<GoogleProfile> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.config.clientId,
      client_secret: options.config.clientSecret,
      code: options.code,
      redirect_uri: options.config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
  }
  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

  const userinfoResponse = await fetchImpl(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userinfoResponse.ok) {
    throw new Error(`Google userinfo request failed: ${userinfoResponse.status} ${userinfoResponse.statusText}`);
  }
  const profile = (await userinfoResponse.json()) as GoogleUserinfoResponse;

  return { providerAccountId: profile.sub, email: profile.email, name: profile.name ?? null };
}
