import { haversine } from "@hereabouts/core";
import type { FeedRequest, PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildFeed, type FeedDependencies, type NearestSettlementResult } from "./feed.js";

const TRUE_POSITION = { lat: 27.9506, lon: -82.4572 };

/** Approximate (flat-earth) point due east of TRUE_POSITION at `distanceM`. Test-only. */
function pointAtApproxDistanceEast(distanceM: number) {
  const metersPerDegLon = 111_320 * Math.cos((TRUE_POSITION.lat * Math.PI) / 180);
  return { lat: TRUE_POSITION.lat, lon: TRUE_POSITION.lon + distanceM / metersPerDegLon };
}

function place(id: string, source: PlaceEvent["source"], approxDistanceM: number, overrides: Partial<PlaceEvent> = {}): PlaceEvent {
  const { lat, lon } = pointAtApproxDistanceEast(approxDistanceM);
  return {
    id,
    source,
    sourceId: id,
    title: id,
    lat,
    lon,
    datePrecision: "unknown",
    summary: "summary",
    sourceExcerpt: "excerpt",
    sourceUrl: "https://example.org/place",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.3,
    externalIds: {},
    ...overrides,
  };
}

function baseRequest(overrides: Partial<FeedRequest> = {}): FeedRequest {
  return {
    lat: TRUE_POSITION.lat,
    lon: TRUE_POSITION.lon,
    headingDeg: 0,
    speedMps: 0,
    mode: "walking",
    heardIds: [],
    topics: [],
    ...overrides,
  };
}

function noopDeps(overrides: Partial<FeedDependencies> = {}): FeedDependencies {
  return {
    fetchWikipedia: vi.fn(async () => []),
    fetchWikidata: vi.fn(async () => []),
    fetchOverpass: vi.fn(async () => []),
    fetchNrhp: vi.fn(() => []),
    fetchNearestSettlement: vi.fn(async () => null),
    fetchWikipediaArticle: vi.fn(async () => null),
    ...overrides,
  };
}

describe("buildFeed — fetching", () => {
  it("queries all three live sources at a privacy-rounded centroid, padded for the mode radius", async () => {
    const deps = noopDeps();
    await buildFeed(baseRequest({ mode: "driving" }), deps);

    for (const fetchFn of [deps.fetchWikipedia, deps.fetchWikidata, deps.fetchOverpass]) {
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [{ center, radiusM }] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(radiusM).toBe(5000 + 1500);
      expect(haversine(TRUE_POSITION, center)).toBeLessThan(1500);
    }
  });

  it("calls the NRHP local dataset synchronously with the same centroid/radius", async () => {
    const deps = noopDeps();
    await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(deps.fetchNrhp).toHaveBeenCalledTimes(1);
    const [{ radiusM }] = (deps.fetchNrhp as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(radiusM).toBe(400 + 1500);
  });

  it("degrades gracefully when one live source rejects, keeping results from the others", async () => {
    const wikipediaPlace = place("wikipedia:1", "wikipedia", 100);
    const deps = noopDeps({
      fetchWikipedia: vi.fn(async () => [wikipediaPlace]),
      fetchWikidata: vi.fn(async () => {
        throw new Error("WDQS timeout");
      }),
    });

    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places.map((p) => p.id)).toEqual(["wikipedia:1"]);
  });
});

describe("buildFeed — dedup and ranking", () => {
  it("clusters the same place from two sources into a single result", async () => {
    const wikipediaRecord = place("wikipedia:1", "wikipedia", 100, {
      title: "Tampa Theatre",
      externalIds: { wikidataQid: "Q1" },
    });
    const wikidataRecord = place("wikidata:Q1", "wikidata", 100, {
      title: "Tampa Theatre",
      externalIds: { wikidataQid: "Q1" },
    });
    const deps = noopDeps({
      fetchWikipedia: vi.fn(async () => [wikipediaRecord]),
      fetchWikidata: vi.fn(async () => [wikidataRecord]),
    });

    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places).toHaveLength(1);
    expect(result.places[0]?.source).toBe("wikipedia"); // higher source preference wins
  });

  it("recomputes real distance from the true position and filters to the mode radius", async () => {
    const near = place("near", "wikipedia", 100);
    const far = place("far", "wikipedia", 2000);
    const deps = noopDeps({ fetchWikipedia: vi.fn(async () => [near, far]) });

    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places.map((p) => p.id)).toEqual(["near"]);
  });

  it("excludes places already heard this trip", async () => {
    const heard = place("heard", "wikipedia", 100);
    const fresh = place("fresh", "wikipedia", 150);
    const deps = noopDeps({ fetchWikipedia: vi.fn(async () => [heard, fresh]) });

    const result = await buildFeed(baseRequest({ mode: "walking", heardIds: ["heard"] }), deps);
    expect(result.places.map((p) => p.id)).toEqual(["fresh"]);
  });

  it("ranks results, most notable/ahead first, rather than returning source order", async () => {
    const obscure = place("obscure", "wikipedia", 100, { notability: 0.1 });
    const notable = place("notable", "wikipedia", 100, { notability: 0.9 });
    const deps = noopDeps({ fetchWikipedia: vi.fn(async () => [obscure, notable]) });

    const result = await buildFeed(baseRequest({ mode: "stationary" }), deps);
    expect(result.places.map((p) => p.id)).toEqual(["notable", "obscure"]);
  });
});

describe("buildFeed — gap filler", () => {
  const SETTLEMENT: NearestSettlementResult = {
    label: "Tampa",
    wikipediaTitle: "Tampa, Florida",
    lat: 27.95,
    lon: -82.46,
  };

  it("falls back to the nearest settlement's article when nothing point-level is in range", async () => {
    const article = place("wikipedia:tampa", "wikipedia", 0, {
      title: "Tampa, Florida",
      summary: "Tampa is a city in Florida.",
    });
    const deps = noopDeps({
      fetchNearestSettlement: vi.fn(async () => SETTLEMENT),
      fetchWikipediaArticle: vi.fn(async () => article),
    });

    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places).toHaveLength(1);
    expect(result.places[0]?.id).toBe("wikipedia:tampa");
    // Honest framing (PLAN.md §7.6): the summary is prefixed...
    expect(result.places[0]?.summary).toBe("Around this part of Tampa: Tampa is a city in Florida.");
    // ...but the grounding substrate (sourceExcerpt) is untouched.
    expect(result.places[0]?.sourceExcerpt).toBe("excerpt");
  });

  it("passes the settlement's own coordinates to the article lookup", async () => {
    const deps = noopDeps({ fetchNearestSettlement: vi.fn(async () => SETTLEMENT) });
    await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(deps.fetchWikipediaArticle).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tampa, Florida", lat: 27.95, lon: -82.46 }),
    );
  });

  it("returns an empty feed when there's no settlement nearby either", async () => {
    const deps = noopDeps(); // fetchNearestSettlement -> null by default
    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places).toEqual([]);
  });

  it("does not re-serve a gap-filler article already heard this trip", async () => {
    const article = place("wikipedia:tampa", "wikipedia", 0);
    const deps = noopDeps({
      fetchNearestSettlement: vi.fn(async () => SETTLEMENT),
      fetchWikipediaArticle: vi.fn(async () => article),
    });

    const result = await buildFeed(baseRequest({ mode: "walking", heardIds: ["wikipedia:tampa"] }), deps);
    expect(result.places).toEqual([]);
  });

  it("degrades to an empty feed (not a throw) if the settlement lookup itself fails", async () => {
    const deps = noopDeps({
      fetchNearestSettlement: vi.fn(async () => {
        throw new Error("WDQS timeout");
      }),
    });
    const result = await buildFeed(baseRequest({ mode: "walking" }), deps);
    expect(result.places).toEqual([]);
  });
});
