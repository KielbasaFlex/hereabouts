import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  fetchArticleByTitle,
  fetchNearbyPlaces,
  GEOSEARCH_MAX_LIMIT,
  GEOSEARCH_MAX_RADIUS_M,
  GEOSEARCH_MIN_RADIUS_M,
  HEREABOUTS_USER_AGENT,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch stub that routes by query string, like the real two-call adapter flow. */
function makeFetchStub(
  geosearchBody: unknown,
  extractsBody: unknown,
): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get("list") === "geosearch") return jsonResponse(geosearchBody);
    if (url.searchParams.get("prop")?.includes("extracts")) return jsonResponse(extractsBody);
    throw new Error(`Unexpected request: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe("fetchNearbyPlaces", () => {
  it("normalises geosearch + extracts fixtures into PlaceEvent records", async () => {
    const geosearchFixture = loadFixture("geosearch.json");
    const extractsFixture = loadFixture("extracts.json");
    const fetchImpl = makeFetchStub(geosearchFixture, extractsFixture);

    const places = await fetchNearbyPlaces({
      center: { lat: 27.9478, lon: -82.459 },
      radiusM: 2000,
      fetchImpl,
    });

    // The disambiguation stub (no extract) is dropped: nothing to ground on.
    expect(places).toHaveLength(2);

    expect(places[0]).toMatchObject({
      id: "wikipedia:61048",
      source: "wikipedia",
      title: "Tampa Theatre",
      lat: 27.9478,
      lon: -82.459,
      distanceM: 410.5,
      license: "cc-by-sa-4.0",
      sourceUrl: "https://en.wikipedia.org/wiki/Tampa_Theatre",
      externalIds: { wikipediaTitle: "Tampa Theatre", wikidataQid: "Q7677026" },
    });
    expect(places[0]?.summary).toContain("Tampa Theatre is a historic movie palace");
    // M1 reads the raw excerpt verbatim: summary and sourceExcerpt match.
    expect(places[0]?.summary).toBe(places[0]?.sourceExcerpt);
    expect(places[0]?.notability).toBeGreaterThan(0);
    expect(places[0]?.notability).toBeLessThanOrEqual(0.6);
    expect(places[0]?.topics).toContain("arts-culture"); // "Tampa Theatre"

    expect(places[1]?.title).toBe("Tampa City Hall");
    expect(places[1]?.topics).toContain("government-civic"); // "City Hall"
    // No pageprops in the fixture for this page: wikidataQid is simply absent.
    expect(places[1]?.externalIds.wikidataQid).toBeUndefined();
    expect(places[1]?.externalIds.wikipediaTitle).toBe("Tampa City Hall");
  });

  it("drops pages the extracts call reports as missing", async () => {
    const fetchImpl = makeFetchStub(
      { query: { geosearch: [{ pageid: 1, title: "Ghost Page", lat: 0, lon: 0, dist: 5 }] } },
      { query: { pages: [{ pageid: 1, title: "Ghost Page", missing: true }] } },
    );

    const places = await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 100, fetchImpl });
    expect(places).toEqual([]);
  });

  it("returns an empty array when geosearch finds nothing (never calls extracts)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ query: { geosearch: [] } }));
    const places = await fetchNearbyPlaces({
      center: { lat: 0, lon: 0 },
      radiusM: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(places).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // geosearch only
  });

  it("falls back to a constructed URL when the extracts call has no fullurl", async () => {
    const fetchImpl = makeFetchStub(
      { query: { geosearch: [{ pageid: 1, title: "Ybor City Historic District", lat: 0, lon: 0, dist: 1 }] } },
      { query: { pages: [{ pageid: 1, title: "Ybor City Historic District", extract: "A cigar-making district." }] } },
    );
    const places = await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 100, fetchImpl });
    expect(places[0]?.sourceUrl).toBe("https://en.wikipedia.org/wiki/Ybor_City_Historic_District");
  });

  it("sends the configured User-Agent on every request", async () => {
    const fetchImpl = makeFetchStub(
      { query: { geosearch: [{ pageid: 1, title: "X", lat: 0, lon: 0, dist: 1 }] } },
      { query: { pages: [{ pageid: 1, title: "X", extract: "Some text." }] } },
    );
    await fetchNearbyPlaces({
      center: { lat: 0, lon: 0 },
      radiusM: 100,
      userAgent: "TestAgent/1.0 (test@example.com)",
      fetchImpl,
    });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, init] of calls) {
      const headers = init.headers as Record<string, string>;
      expect(headers["User-Agent"]).toBe("TestAgent/1.0 (test@example.com)");
    }
  });

  it("defaults to the documented Hereabouts User-Agent", async () => {
    const fetchImpl = makeFetchStub(
      { query: { geosearch: [] } },
      { query: { pages: [] } },
    );
    await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 100, fetchImpl });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(HEREABOUTS_USER_AGENT);
  });

  it("clamps radius and limit to Wikipedia's documented bounds rather than rejecting them", async () => {
    const fetchImpl = makeFetchStub({ query: { geosearch: [] } }, { query: { pages: [] } });

    await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 999_999, limit: 999_999, fetchImpl });
    const [firstCallUrl] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(String(firstCallUrl));
    expect(url.searchParams.get("gsradius")).toBe(String(GEOSEARCH_MAX_RADIUS_M));
    expect(url.searchParams.get("gslimit")).toBe(String(GEOSEARCH_MAX_LIMIT));

    await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 0, fetchImpl });
    const [secondCallUrl] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]!;
    const url2 = new URL(String(secondCallUrl));
    expect(url2.searchParams.get("gsradius")).toBe(String(GEOSEARCH_MIN_RADIUS_M));
  });

  it("throws a descriptive error on a non-OK response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }),
    ) as unknown as typeof fetch;

    await expect(
      fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 100, fetchImpl }),
    ).rejects.toThrow(/503/);
  });
});

describe("fetchArticleByTitle", () => {
  it("fetches and normalises a single article by exact title", async () => {
    const fixture = loadFixture("article-by-title.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;

    const place = await fetchArticleByTitle({
      title: "Tampa, Florida",
      lat: 27.9506,
      lon: -82.4572,
      fetchImpl,
    });

    expect(place).toMatchObject({
      id: "wikipedia:100200",
      source: "wikipedia",
      title: "Tampa, Florida",
      lat: 27.9506,
      lon: -82.4572,
      sourceUrl: "https://en.wikipedia.org/wiki/Tampa,_Florida",
      externalIds: { wikipediaTitle: "Tampa, Florida", wikidataQid: "Q49233" },
    });
    expect(place?.summary).toContain("Tampa is a city on the Gulf Coast");
  });

  it("does not report a distance — the caller supplies coordinates, not a query center", async () => {
    const fixture = loadFixture("article-by-title.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;
    const place = await fetchArticleByTitle({ title: "Tampa, Florida", lat: 0, lon: 0, fetchImpl });
    expect(place?.distanceM).toBeUndefined();
  });

  it("returns null for a missing or extract-less page", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ query: { pages: [{ pageid: 1, title: "Nonexistent", missing: true }] } }),
    ) as unknown as typeof fetch;

    const place = await fetchArticleByTitle({ title: "Nonexistent", lat: 0, lon: 0, fetchImpl });
    expect(place).toBeNull();
  });
});
