import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode } from "./google.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CONFIG = { clientId: "client-123", clientSecret: "secret-456", redirectUri: "https://app.example.com/callback" };

describe("buildGoogleAuthorizeUrl", () => {
  it("builds a well-formed authorize URL with the required parameters", () => {
    const url = new URL(buildGoogleAuthorizeUrl(CONFIG, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeGoogleCode", () => {
  it("exchanges a code for tokens, then fetches and normalises the profile", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = String(url);
      if (urlStr.includes("oauth2.googleapis.com/token")) return jsonResponse(loadFixture("google-token.json"));
      if (urlStr.includes("openidconnect.googleapis.com")) return jsonResponse(loadFixture("google-userinfo.json"));
      throw new Error(`unexpected URL: ${urlStr}`);
    }) as unknown as typeof fetch;

    const profile = await exchangeGoogleCode({ code: "auth-code-xyz", config: CONFIG, fetchImpl });

    expect(profile).toEqual({
      providerAccountId: "109876543210987654321",
      email: "example.user@gmail.com",
      name: "Example User",
    });
  });

  it("sends the code exchange as form-urlencoded with the standard OAuth2 fields", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).includes("token")) {
        expect(init?.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
        const body = new URLSearchParams(init?.body as string);
        expect(body.get("client_id")).toBe("client-123");
        expect(body.get("code")).toBe("auth-code-xyz");
        expect(body.get("grant_type")).toBe("authorization_code");
        return jsonResponse(loadFixture("google-token.json"));
      }
      return jsonResponse(loadFixture("google-userinfo.json"));
    }) as unknown as typeof fetch;

    await exchangeGoogleCode({ code: "auth-code-xyz", config: CONFIG, fetchImpl });
  });

  it("throws a descriptive error when the token exchange fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad code", { status: 400, statusText: "Bad Request" }),
    ) as unknown as typeof fetch;

    await expect(exchangeGoogleCode({ code: "bad-code", config: CONFIG, fetchImpl })).rejects.toThrow(/400/);
  });
});
