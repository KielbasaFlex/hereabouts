import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildGitHubAuthorizeUrl, exchangeGitHubCode } from "./github.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CONFIG = { clientId: "client-123", clientSecret: "secret-456", redirectUri: "https://app.example.com/callback" };

describe("buildGitHubAuthorizeUrl", () => {
  it("builds a well-formed authorize URL", () => {
    const url = new URL(buildGitHubAuthorizeUrl(CONFIG, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toContain("user:email");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

function fetchStub(userFixture: string): typeof fetch {
  return vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    const urlStr = String(url);
    if (urlStr.includes("/login/oauth/access_token")) return jsonResponse(loadFixture("github-token.json"));
    if (urlStr.includes("/user/emails")) return jsonResponse(loadFixture("github-emails.json"));
    if (urlStr.endsWith("/user")) return jsonResponse(loadFixture(userFixture));
    throw new Error(`unexpected URL: ${urlStr}`);
  }) as unknown as typeof fetch;
}

describe("exchangeGitHubCode", () => {
  it("normalises a profile with a public email directly from /user", async () => {
    const fetchImpl = fetchStub("github-user-public-email.json");
    const profile = await exchangeGitHubCode({ code: "auth-code", config: CONFIG, fetchImpl });

    expect(profile).toEqual({ providerAccountId: "123456", email: "exampleuser@example.org", name: "Example User" });
  });

  it("falls back to /user/emails for a verified primary when /user's email is private", async () => {
    const fetchImpl = fetchStub("github-user-private-email.json");
    const profile = await exchangeGitHubCode({ code: "auth-code", config: CONFIG, fetchImpl });

    expect(profile.email).toBe("verified-primary@example.org");
    expect(profile.providerAccountId).toBe("654321");
    expect(profile.name).toBe("privateuser"); // falls back to login when name is null
  });

  it("throws if no verified primary email can be found", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = String(url);
      if (urlStr.includes("access_token")) return jsonResponse(loadFixture("github-token.json"));
      if (urlStr.includes("/user/emails")) return jsonResponse([{ email: "x@example.org", primary: false, verified: true }]);
      return jsonResponse(loadFixture("github-user-private-email.json"));
    }) as unknown as typeof fetch;

    await expect(exchangeGitHubCode({ code: "auth-code", config: CONFIG, fetchImpl })).rejects.toThrow(/verified primary email/);
  });

  it("throws a descriptive error when the token exchange fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad code", { status: 400, statusText: "Bad Request" }),
    ) as unknown as typeof fetch;
    await expect(exchangeGitHubCode({ code: "bad-code", config: CONFIG, fetchImpl })).rejects.toThrow(/400/);
  });
});
