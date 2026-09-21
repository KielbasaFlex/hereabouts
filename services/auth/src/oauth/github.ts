/**
 * GitHub OAuth2 (PLAN.md §12 "email + social"). GitHub's own long-stable
 * OAuth Apps flow — see `fixtures/README.md` for what's unverified here.
 * GitHub's user endpoint can return a null `email` for an account with a
 * private email setting, so this also calls `/user/emails` to find the
 * verified primary address, exactly as GitHub's own docs recommend.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildGitHubAuthorizeUrl(config: Pick<GitHubOAuthConfig, "clientId" | "redirectUri">, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface GitHubProfile {
  providerAccountId: string;
  email: string;
  name: string | null;
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
}

interface GitHubEmailEntry {
  email: string;
  primary: boolean;
  verified: boolean;
}

export interface ExchangeGitHubCodeOptions {
  code: string;
  config: GitHubOAuthConfig;
  fetchImpl?: typeof fetch;
}

export async function exchangeGitHubCode(options: ExchangeGitHubCodeOptions): Promise<GitHubProfile> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: options.config.clientId,
      client_secret: options.config.clientSecret,
      code: options.code,
      redirect_uri: options.config.redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
  }
  const tokens = (await tokenResponse.json()) as GitHubTokenResponse;
  const authHeader = { Authorization: `Bearer ${tokens.access_token}` };

  const userResponse = await fetchImpl(USER_URL, { headers: authHeader });
  if (!userResponse.ok) {
    throw new Error(`GitHub user request failed: ${userResponse.status} ${userResponse.statusText}`);
  }
  const profile = (await userResponse.json()) as GitHubUserResponse;

  let email = profile.email;
  if (!email) {
    const emailsResponse = await fetchImpl(EMAILS_URL, { headers: authHeader });
    if (!emailsResponse.ok) {
      throw new Error(`GitHub emails request failed: ${emailsResponse.status} ${emailsResponse.statusText}`);
    }
    const emails = (await emailsResponse.json()) as GitHubEmailEntry[];
    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) throw new Error("GitHub account has no verified primary email");
    email = primary.email;
  }

  return { providerAccountId: String(profile.id), email, name: profile.name ?? profile.login };
}
