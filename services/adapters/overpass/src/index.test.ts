import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fetchNearbyPlaces } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CENTER = { lat: 27.9506, lon: -82.4572 };

describe("fetchNearbyPlaces", () => {
  it("normalises node and way elements into PlaceEvent records", async () => {
    const fixture = loadFixture("response.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;

    const places = await fetchNearbyPlaces({ center: CENTER, radiusM: 1500, fetchImpl });

    // The third element (no `name` tag) is dropped — nothing to title it with.
    expect(places).toHaveLength(2);

    const memorial = places.find((p) => p.id === "osm:node/123456789");
    expect(memorial).toMatchObject({
      source: "osm",
      title: "Confederate Memorial",
      lat: 27.94851,
      lon: -82.45772,
      license: "odbl-1.0",
      sourceUrl: "https://www.openstreetmap.org/node/123456789",
      externalIds: { osmId: "node/123456789", wikidataQid: "Q99999999" },
    });
    expect(memorial?.sourceExcerpt).toContain("historic=monument");
    expect(memorial?.sourceExcerpt).not.toContain("1911"); // start_date isn't in our excerpt-building tag list
    expect(memorial?.topics).toEqual(expect.arrayContaining(["military", "commemorative"]));

    const courthouse = places.find((p) => p.id === "osm:way/987654321");
    // Ways have no lat/lon of their own — `out center;` gives a computed centroid.
    expect(courthouse).toMatchObject({ lat: 27.9502, lon: -82.4561 });
    expect(courthouse?.sourceExcerpt).toContain("heritage designation of 2");
    expect(courthouse?.topics).toContain("government-civic");
    // "en:Old Federal Courthouse (Tampa)" -> the lang prefix is stripped.
    expect(courthouse?.externalIds.wikipediaTitle).toBe("Old Federal Courthouse (Tampa)");
  });

  it("computes distance locally via haversine, not from the source", async () => {
    const fixture = loadFixture("response.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;
    const places = await fetchNearbyPlaces({ center: CENTER, radiusM: 1500, fetchImpl });
    for (const place of places) {
      expect(place.distanceM).toBeGreaterThan(0);
      expect(place.distanceM).toBeLessThan(1500);
    }
  });

  it("skips elements with no name tag", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ elements: [{ type: "node", id: 1, lat: 0, lon: 0, tags: { historic: "yes" } }] }),
    ) as unknown as typeof fetch;
    const places = await fetchNearbyPlaces({ center: CENTER, radiusM: 500, fetchImpl });
    expect(places).toEqual([]);
  });

  it("skips a way with no computed center", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ elements: [{ type: "way", id: 2, tags: { name: "Ghost Way", historic: "yes" } }] }),
    ) as unknown as typeof fetch;
    const places = await fetchNearbyPlaces({ center: CENTER, radiusM: 500, fetchImpl });
    expect(places).toEqual([]);
  });

  it("falls back to a plain sentence when no recognised descriptive tag is present", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ elements: [{ type: "node", id: 3, lat: 0, lon: 0, tags: { name: "Mystery Marker" } }] }),
    ) as unknown as typeof fetch;
    const places = await fetchNearbyPlaces({ center: { lat: 0, lon: 0 }, radiusM: 500, fetchImpl });
    expect(places[0]?.sourceExcerpt).toBe(
      "Mystery Marker is tagged in OpenStreetMap, with no further descriptive tags present.",
    );
  });

  it("sends the query as a POST body, not a query string", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("[out:json]");
      expect(String(init?.body)).toContain("historic");
      return jsonResponse({ elements: [] });
    }) as unknown as typeof fetch;

    await fetchNearbyPlaces({ center: CENTER, radiusM: 500, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error on a non-OK response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 504, statusText: "Gateway Timeout" }),
    ) as unknown as typeof fetch;
    await expect(fetchNearbyPlaces({ center: CENTER, radiusM: 500, fetchImpl })).rejects.toThrow(/504/);
  });
});
