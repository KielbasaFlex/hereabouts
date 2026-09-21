import type { PlaceEvent } from "@hereabouts/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS_BY_MODE, etaFit, rankPlaces, scorePlace } from "./index.js";

const OBSERVER = { lat: 27.9506, lon: -82.4572, headingDeg: 0, speedMps: 5 };

function place(overrides: Partial<PlaceEvent> & Pick<PlaceEvent, "id" | "title">): PlaceEvent {
  return {
    source: "wikipedia",
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

describe("etaFit", () => {
  it("plateaus at 1.0 across the 40-120s window", () => {
    expect(etaFit(40)).toBeCloseTo(1);
    expect(etaFit(80)).toBeCloseTo(1);
    expect(etaFit(120)).toBeCloseTo(1);
  });

  it("ramps up from 0 toward 1 below 40s", () => {
    expect(etaFit(0)).toBe(0);
    expect(etaFit(20)).toBeCloseTo(0.5);
  });

  it("decays above 120s", () => {
    expect(etaFit(200)).toBeLessThan(1);
    expect(etaFit(200)).toBeGreaterThan(0);
    expect(etaFit(1000)).toBe(0);
  });

  it("is 0 for a non-finite or negative ETA", () => {
    expect(etaFit(Infinity)).toBe(0);
    expect(etaFit(-5)).toBe(0);
  });
});

describe("scorePlace", () => {
  it("scores a place directly ahead higher than one directly behind, all else equal", () => {
    const ahead = place({ id: "ahead", title: "Ahead", lat: 27.96, lon: -82.4572 }); // due north
    const behind = place({ id: "behind", title: "Behind", lat: 27.94, lon: -82.4572 }); // due south

    const scoreAhead = scorePlace(ahead, OBSERVER, { mode: "driving", heardIds: new Set() });
    const scoreBehind = scorePlace(behind, OBSERVER, { mode: "driving", heardIds: new Set() });

    expect(scoreAhead.score).toBeGreaterThan(scoreBehind.score);
  });

  it("scores a more notable place higher, all else equal", () => {
    const notable = place({ id: "a", title: "A", notability: 0.9 });
    const obscure = place({ id: "b", title: "B", notability: 0.1 });

    const scoreNotable = scorePlace(notable, OBSERVER, { mode: "stationary", heardIds: new Set() });
    const scoreObscure = scorePlace(obscure, OBSERVER, { mode: "stationary", heardIds: new Set() });

    expect(scoreNotable.score).toBeGreaterThan(scoreObscure.score);
  });

  it("scores a heard place lower than an otherwise-identical unheard one", () => {
    const unheard = place({ id: "new", title: "New" });
    const heard = place({ id: "old", title: "Old" });

    const scoreUnheard = scorePlace(unheard, OBSERVER, { mode: "walking", heardIds: new Set() });
    const scoreHeard = scorePlace(heard, OBSERVER, { mode: "walking", heardIds: new Set(["old"]) });

    expect(scoreUnheard.score).toBeGreaterThan(scoreHeard.score);
  });

  it("scores a preferred-topic match higher than a non-matching one", () => {
    const matching = place({ id: "war", title: "Fort", topics: ["war-and-military"] });
    const nonMatching = place({ id: "art", title: "Museum", topics: ["architecture"] });

    const ctx = { mode: "walking" as const, heardIds: new Set<string>(), preferredTopics: ["war-and-military"] };
    expect(scorePlace(matching, OBSERVER, ctx).score).toBeGreaterThan(
      scorePlace(nonMatching, OBSERVER, ctx).score,
    );
  });

  it("does not hard-exclude a non-matching topic — it merely scores lower", () => {
    const nonMatching = place({ id: "art", title: "Museum", topics: ["architecture"] });
    const ctx = { mode: "walking" as const, heardIds: new Set<string>(), preferredTopics: ["war-and-military"] };
    const result = scorePlace(nonMatching, OBSERVER, ctx);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores a higher-quality source higher, all else equal", () => {
    const wiki = place({ id: "w", title: "W", source: "wikipedia" });
    const osm = place({ id: "o", title: "O", source: "osm" });

    const ctx = { mode: "stationary" as const, heardIds: new Set<string>() };
    expect(scorePlace(wiki, OBSERVER, ctx).score).toBeGreaterThan(scorePlace(osm, OBSERVER, ctx).score);
  });

  it("weighs ahead-ness and ETA more heavily in driving mode than stationary mode", () => {
    expect(DEFAULT_WEIGHTS_BY_MODE.driving.ahead).toBeGreaterThan(DEFAULT_WEIGHTS_BY_MODE.stationary.ahead);
    expect(DEFAULT_WEIGHTS_BY_MODE.driving.eta).toBeGreaterThan(DEFAULT_WEIGHTS_BY_MODE.stationary.eta);
  });

  it("respects an explicit weights override instead of the mode default", () => {
    const a = place({ id: "a", title: "A", notability: 0.9, source: "osm" });
    const onlySource = scorePlace(a, OBSERVER, {
      mode: "walking",
      heardIds: new Set(),
      weights: { eta: 0, ahead: 0, notability: 0, topic: 0, novelty: 0, source: 1 },
    });
    // With every weight zeroed except source, the score is exactly the source quality score.
    expect(onlySource.score).toBeCloseTo(0.5); // osm's SOURCE_QUALITY_SCORE
  });
});

describe("rankPlaces", () => {
  it("sorts descending by score", () => {
    const low = place({ id: "low", title: "Low", notability: 0.1 });
    const high = place({ id: "high", title: "High", notability: 0.9 });

    const ranked = rankPlaces([low, high], OBSERVER, { mode: "stationary", heardIds: new Set() });
    expect(ranked.map((r) => r.place.id)).toEqual(["high", "low"]);
  });

  it("returns one ranked entry per input place", () => {
    const places = [place({ id: "a", title: "A" }), place({ id: "b", title: "B" }), place({ id: "c", title: "C" })];
    const ranked = rankPlaces(places, OBSERVER, { mode: "walking", heardIds: new Set() });
    expect(ranked).toHaveLength(3);
  });
});
