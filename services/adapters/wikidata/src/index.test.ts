import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fetchNearbyItems, fetchNearestSettlement } from "./index.js";

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

describe("fetchNearbyItems", () => {
  it("normalises SPARQL bindings into dated PlaceEvent records", async () => {
    const fixture = loadFixture("nearby-items.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;

    const places = await fetchNearbyItems({ center: { lat: 27.9506, lon: -82.4572 }, radiusM: 2000, fetchImpl });

    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({
      id: "wikidata:Q7677026",
      source: "wikidata",
      title: "Tampa Theatre",
      lat: 27.9478,
      lon: -82.459,
      dateStart: 1926,
      datePrecision: "year", // precision 9
      license: "cc0",
      externalIds: { wikidataQid: "Q7677026" },
    });
    expect(places[0]?.distanceM).toBeCloseTo(410, 0); // 0.41 km -> 410 m
    expect(places[0]?.sourceExcerpt).toContain("Tampa Theatre");
    expect(places[0]?.sourceExcerpt).toContain("1926");

    // Second binding has precision 8 (decade).
    expect(places[1]).toMatchObject({ datePrecision: "decade", eraText: "the 1910s" });
  });

  it("returns an empty array when nothing nearby has a recorded date", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: { bindings: [] } })) as unknown as typeof fetch;
    const places = await fetchNearbyItems({ center: { lat: 0, lon: 0 }, radiusM: 1000, fetchImpl });
    expect(places).toEqual([]);
  });

  it("skips a binding missing required fields rather than throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: {
          bindings: [
            { item: { value: "http://www.wikidata.org/entity/Q1" } }, // no location/date
          ],
        },
      }),
    ) as unknown as typeof fetch;

    const places = await fetchNearbyItems({ center: { lat: 0, lon: 0 }, radiusM: 1000, fetchImpl });
    expect(places).toEqual([]);
  });

  it("throws a descriptive error on a non-OK response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 500, statusText: "Internal Server Error" }),
    ) as unknown as typeof fetch;

    await expect(
      fetchNearbyItems({ center: { lat: 0, lon: 0 }, radiusM: 1000, fetchImpl }),
    ).rejects.toThrow(/500/);
  });
});

describe("fetchNearestSettlement", () => {
  it("normalises the nearest settlement binding", async () => {
    const fixture = loadFixture("nearest-settlement.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;

    const settlement = await fetchNearestSettlement({ center: { lat: 27.95, lon: -82.46 }, fetchImpl });

    expect(settlement).toMatchObject({
      qid: "Q49233",
      label: "Tampa",
      wikipediaTitle: "Tampa, Florida",
    });
    expect(settlement?.distanceM).toBeCloseTo(50, 0); // 0.05 km -> 50 m
  });

  it("returns null when nothing matches", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: { bindings: [] } })) as unknown as typeof fetch;
    const settlement = await fetchNearestSettlement({ center: { lat: 0, lon: 0 }, fetchImpl });
    expect(settlement).toBeNull();
  });
});
