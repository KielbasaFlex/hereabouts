import { describe, expect, it } from "vitest";
import { FeedRequest, PlaceEvent } from "./index.js";

describe("PlaceEvent", () => {
  it("accepts a well-formed record", () => {
    const result = PlaceEvent.safeParse({
      id: "wikipedia:12345",
      source: "wikipedia",
      sourceId: "12345",
      title: "Old Hyde Park Village",
      lat: 27.9506,
      lon: -82.4939,
      datePrecision: "decade",
      summary: "A historic shopping district.",
      sourceExcerpt: "Hyde Park Village was developed beginning in the 1920s.",
      sourceUrl: "https://en.wikipedia.org/wiki/Hyde_Park_Village",
      license: "cc-by-sa-4.0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topics).toEqual([]); // default applied
    }
  });

  it("rejects an out-of-range coordinate", () => {
    const result = PlaceEvent.safeParse({
      id: "wikipedia:1",
      source: "wikipedia",
      sourceId: "1",
      title: "Nowhere",
      lat: 200,
      lon: 0,
      datePrecision: "unknown",
      summary: "",
      sourceExcerpt: "",
      sourceUrl: "https://en.wikipedia.org/wiki/Nowhere",
      license: "cc-by-sa-4.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown license", () => {
    const result = PlaceEvent.safeParse({
      id: "wikipedia:1",
      source: "wikipedia",
      sourceId: "1",
      title: "Nowhere",
      lat: 0,
      lon: 0,
      datePrecision: "unknown",
      summary: "",
      sourceExcerpt: "",
      sourceUrl: "https://en.wikipedia.org/wiki/Nowhere",
      license: "all-rights-reserved",
    });
    expect(result.success).toBe(false);
  });
});

describe("FeedRequest", () => {
  it("applies defaults for heading, speed, mode, heardIds, and topics", () => {
    const result = FeedRequest.parse({ lat: 27.95, lon: -82.46 });
    expect(result.headingDeg).toBe(0);
    expect(result.speedMps).toBe(0);
    expect(result.mode).toBe("walking");
    expect(result.heardIds).toEqual([]);
    expect(result.topics).toEqual([]);
  });

  it("rejects an invalid mode", () => {
    const result = FeedRequest.safeParse({ lat: 0, lon: 0, mode: "flying" });
    expect(result.success).toBe(false);
  });
});
