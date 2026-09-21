import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it } from "vitest";
import { clusterPlaces, titleSimilarity } from "./index.js";

function place(overrides: Partial<PlaceEvent> & Pick<PlaceEvent, "id" | "source" | "title">): PlaceEvent {
  return {
    sourceId: overrides.id,
    lat: 27.9506,
    lon: -82.4572,
    datePrecision: "unknown",
    summary: "summary",
    sourceExcerpt: "excerpt",
    sourceUrl: "https://example.org/place",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.3,
    externalIds: {},
    isRegional: false,
    ...overrides,
  };
}

describe("titleSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(titleSimilarity("Tampa Theatre", "Tampa Theatre")).toBe(1);
  });

  it("is 1 for two empty strings", () => {
    expect(titleSimilarity("", "")).toBe(1);
  });

  it("is 0 when one string is empty and the other isn't", () => {
    expect(titleSimilarity("", "Tampa Theatre")).toBe(0);
  });

  it("is high for near-identical titles differing in case/punctuation", () => {
    expect(titleSimilarity("Tampa Theatre", "tampa theatre!")).toBeGreaterThan(0.9);
  });

  it("is low for unrelated titles", () => {
    expect(titleSimilarity("Tampa Theatre", "Golden Gate Bridge")).toBeLessThan(0.3);
  });

  it("is moderate-to-high for a minor variant (e.g. dropped 'The')", () => {
    const sim = titleSimilarity("The Tampa Theatre", "Tampa Theatre");
    expect(sim).toBeGreaterThanOrEqual(0.55);
  });
});

describe("clusterPlaces", () => {
  it("keeps unrelated places in separate clusters", () => {
    const a = place({ id: "wikipedia:1", source: "wikipedia", title: "Tampa Theatre" });
    const b = place({
      id: "wikipedia:2",
      source: "wikipedia",
      title: "Golden Gate Bridge",
      lat: 37.8199,
      lon: -122.4783,
    });

    const clusters = clusterPlaces([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("clusters two records sharing a Wikidata QID regardless of distance or title", () => {
    const wikipediaRecord = place({
      id: "wikipedia:1",
      source: "wikipedia",
      title: "Tampa Theatre",
      externalIds: { wikidataQid: "Q7677026" },
    });
    const wikidataRecord = place({
      id: "wikidata:Q7677026",
      source: "wikidata",
      title: "Tampa Theatre (historic cinema)", // deliberately different title
      lat: 40, // deliberately far away — identity link overrides distance
      lon: -100,
      externalIds: { wikidataQid: "Q7677026" },
    });

    const clusters = clusterPlaces([wikipediaRecord, wikidataRecord]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.preferred.source).toBe("wikipedia"); // higher source preference
    expect(clusters[0]?.supporting.map((p) => p.id)).toEqual(["wikidata:Q7677026"]);
  });

  it("clusters two records sharing an NRHP reference number", () => {
    const a = place({
      id: "nrhp:73000001",
      source: "nrhp",
      title: "Old Hillsborough County Courthouse",
      externalIds: { nrhpRefNumber: "73000001" },
    });
    const b = place({
      id: "osm:node/555",
      source: "osm",
      title: "Historic Courthouse",
      externalIds: { nrhpRefNumber: "73000001" },
    });

    const clusters = clusterPlaces([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.preferred.id).toBe("nrhp:73000001");
  });

  it("clusters nearby records with similar titles even without an identity link", () => {
    const a = place({ id: "wikipedia:1", source: "wikipedia", title: "Tampa Theatre", lat: 27.9478, lon: -82.459 });
    const b = place({
      id: "osm:node/1",
      source: "osm",
      title: "Tampa Theatre",
      lat: 27.94785, // ~6m away
      lon: -82.45905,
    });

    const clusters = clusterPlaces([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.preferred.source).toBe("wikipedia");
  });

  it("does not fuzzy-cluster nearby records with dissimilar titles", () => {
    const a = place({ id: "wikipedia:1", source: "wikipedia", title: "Tampa Theatre", lat: 27.9478, lon: -82.459 });
    const b = place({
      id: "osm:node/2",
      source: "osm",
      title: "City Parking Garage",
      lat: 27.94781, // ~1m away — distance alone is not enough
      lon: -82.45901,
    });

    const clusters = clusterPlaces([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("does not fuzzy-cluster similar titles that are far apart", () => {
    const a = place({ id: "wikipedia:1", source: "wikipedia", title: "City Hall", lat: 27.9478, lon: -82.459 });
    const b = place({ id: "wikipedia:2", source: "wikipedia", title: "City Hall", lat: 40, lon: -100 });

    const clusters = clusterPlaces([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("merges three-way clusters via a chain of pairwise matches", () => {
    const a = place({
      id: "wikipedia:1",
      source: "wikipedia",
      title: "Tampa Theatre",
      externalIds: { wikidataQid: "Q1" },
    });
    const b = place({
      id: "wikidata:Q1",
      source: "wikidata",
      title: "Tampa Theatre",
      externalIds: { wikidataQid: "Q1" },
    });
    const c = place({
      id: "osm:node/3",
      source: "osm",
      title: "Tampa Theatre",
      lat: 27.95061, // close enough to fuzzy-match "b", not linked by id
      lon: -82.45721,
    });

    const clusters = clusterPlaces([a, b, c]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.supporting).toHaveLength(2);
  });

  it("never puts one place in more than one cluster", () => {
    const places = Array.from({ length: 5 }, (_, i) =>
      place({ id: `wikipedia:${i}`, source: "wikipedia", title: `Place ${i}`, lat: i, lon: i }),
    );
    const clusters = clusterPlaces(places);
    const seen = new Set<string>();
    for (const cluster of clusters) {
      for (const member of [cluster.preferred, ...cluster.supporting]) {
        expect(seen.has(member.id)).toBe(false);
        seen.add(member.id);
      }
    }
    expect(seen.size).toBe(places.length);
  });
});
