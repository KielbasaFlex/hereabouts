import { describe, expect, it } from "vitest";
import type { NrhpRecord } from "./dataset.js";
import { queryNearby } from "./index.js";

const CENTER = { lat: 27.9506, lon: -82.4572 };

describe("queryNearby", () => {
  it("returns only records within radius, nearest first", () => {
    const places = queryNearby({ center: CENTER, radiusM: 2000 });
    expect(places.length).toBeGreaterThan(0);
    for (let i = 1; i < places.length; i++) {
      expect(places[i]!.distanceM!).toBeGreaterThanOrEqual(places[i - 1]!.distanceM!);
    }
    // The far-away sample records (different city) must not appear.
    expect(places.every((p) => (p.distanceM ?? Infinity) <= 2000)).toBe(true);
  });

  it("returns an empty array when nothing in the dataset is within radius", () => {
    const places = queryNearby({ center: { lat: 0, lon: 0 }, radiusM: 1000 });
    expect(places).toEqual([]);
  });

  it("normalises fields correctly, including a record with no significance note", () => {
    const dataset: NrhpRecord[] = [
      { refNumber: "T0001", name: "Test Building", lat: CENTER.lat, lon: CENTER.lon, listedYear: 1990 },
    ];
    const [place] = queryNearby({ center: CENTER, radiusM: 100, dataset });
    expect(place).toMatchObject({
      id: "nrhp:T0001",
      source: "nrhp",
      title: "Test Building",
      dateStart: 1990,
      datePrecision: "year",
      license: "public-domain-usgov",
      externalIds: { nrhpRefNumber: "T0001" },
    });
    expect(place?.sourceExcerpt).toBe("Test Building is listed on the National Register of Historic Places, listed in 1990.");
  });

  it("handles a record with neither listedYear nor significance", () => {
    const dataset: NrhpRecord[] = [{ refNumber: "T0002", name: "Bare Record", lat: CENTER.lat, lon: CENTER.lon }];
    const [place] = queryNearby({ center: CENTER, radiusM: 100, dataset });
    expect(place?.datePrecision).toBe("unknown");
    expect(place?.dateStart).toBeUndefined();
    expect(place?.sourceExcerpt).toBe("Bare Record is listed on the National Register of Historic Places.");
  });

  it("appends the significance note when present", () => {
    const dataset: NrhpRecord[] = [
      {
        refNumber: "T0003",
        name: "Noted Building",
        lat: CENTER.lat,
        lon: CENTER.lon,
        listedYear: 2001,
        significance: "A fine example of something.",
      },
    ];
    const [place] = queryNearby({ center: CENTER, radiusM: 100, dataset });
    expect(place?.sourceExcerpt).toBe(
      "Noted Building is listed on the National Register of Historic Places, listed in 2001. A fine example of something.",
    );
    expect(place?.notability).toBeGreaterThan(0.6); // boosted by having a significance note
  });

  it("classifies topics from the record's name and significance text", () => {
    const dataset: NrhpRecord[] = [
      {
        refNumber: "T0004",
        name: "Old County Courthouse",
        lat: CENTER.lat,
        lon: CENTER.lon,
        significance: "A rare surviving 19th-century schoolhouse annex.",
      },
    ];
    const [place] = queryNearby({ center: CENTER, radiusM: 100, dataset });
    expect(place?.topics).toContain("government-civic");
    expect(place?.topics).toContain("education");
  });

  it("accepts an injected dataset instead of the bundled placeholder sample", () => {
    const customDataset: NrhpRecord[] = [{ refNumber: "CUSTOM", name: "Custom Site", lat: CENTER.lat, lon: CENTER.lon }];
    const places = queryNearby({ center: CENTER, radiusM: 100, dataset: customDataset });
    expect(places).toHaveLength(1);
    expect(places[0]?.id).toBe("nrhp:CUSTOM");
  });
});
