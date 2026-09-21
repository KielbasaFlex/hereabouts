import { describe, expect, it } from "vitest";
import type { SpatialFrame } from "../spatial-frame/index.js";
import {
  checkEntities,
  checkLength,
  checkNumeralsAndDates,
  checkPhraseOverlap,
  checkSpatialLanguage,
  checkVaguenessPreserved,
  validateGrounding,
} from "./index.js";

const REGIONAL_FRAME: SpatialFrame = { allow: "regional", distanceM: 5000, side: null };
const DIRECTIONAL_FRAME: SpatialFrame = { allow: "directional", distanceM: 20, side: "left" };

describe("checkNumeralsAndDates", () => {
  const source = "The theatre opened in 1926 and seats 1,500 people.";

  it("passes when every narration numeral appears in the source", () => {
    expect(checkNumeralsAndDates("It opened in 1926 with 1500 seats.", source).passed).toBe(true);
  });

  it("fails when the narration invents a numeral absent from the source", () => {
    const result = checkNumeralsAndDates("It opened in 1928.", source);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("1928");
  });

  it("is comma-insensitive when matching", () => {
    expect(checkNumeralsAndDates("It seats 1,500 guests.", source).passed).toBe(true);
  });
});

describe("checkEntities", () => {
  const source = "The Tampa Theatre is a historic movie palace in downtown Tampa.";

  it("passes when named entities appear in the source", () => {
    expect(checkEntities("Tampa Theatre is a lovely old building.", source).passed).toBe(true);
  });

  it("fails when the narration invents a named entity absent from the source", () => {
    const result = checkEntities("It was designed by John Eberson in a lavish style.", source);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("John Eberson");
  });

  it("does not flag ordinary sentence-initial capitalization", () => {
    expect(checkEntities("The building is lovely. This is a landmark.", source).passed).toBe(true);
  });
});

describe("checkVaguenessPreserved", () => {
  it("passes a specific year when precision is exact or year", () => {
    expect(checkVaguenessPreserved("It opened in 1926.", "exact").passed).toBe(true);
    expect(checkVaguenessPreserved("It opened in 1926.", "year").passed).toBe(true);
  });

  it("passes decade phrasing (e.g. '1920s') when precision is decade", () => {
    expect(checkVaguenessPreserved("It opened in the 1920s.", "decade").passed).toBe(true);
  });

  it("fails a sharpened specific year when precision is only decade", () => {
    const result = checkVaguenessPreserved("It opened in 1926.", "decade");
    expect(result.passed).toBe(false);
  });

  it("fails a sharpened specific year when precision is only century", () => {
    expect(checkVaguenessPreserved("It opened in 1926.", "century").passed).toBe(false);
  });

  it("passes anything when precision is unknown (nothing established to violate)", () => {
    expect(checkVaguenessPreserved("It opened in 1926.", "unknown").passed).toBe(true);
  });
});

describe("checkSpatialLanguage", () => {
  it("allows directional phrasing when the spatial frame permits it", () => {
    expect(checkSpatialLanguage("It's just ahead on your left.", DIRECTIONAL_FRAME).passed).toBe(true);
  });

  it("fails directional phrasing when the spatial frame is regional", () => {
    const result = checkSpatialLanguage("You'll see it on your right.", REGIONAL_FRAME);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("on your right");
  });

  it("passes non-directional phrasing under a regional frame", () => {
    expect(checkSpatialLanguage("Somewhere around this part of town.", REGIONAL_FRAME).passed).toBe(true);
  });
});

describe("checkPhraseOverlap", () => {
  const source = "The Tampa Theatre opened its doors to the public in 1926 as a movie palace.";

  it("passes a genuine paraphrase", () => {
    const narration = "Back in 1926, this old movie house first welcomed audiences through its doors.";
    expect(checkPhraseOverlap(narration, source).passed).toBe(true);
  });

  it("fails when a long stretch of source phrasing is lifted verbatim", () => {
    const narration = "People say the Tampa Theatre opened its doors to the public in 1926, which is neat.";
    const result = checkPhraseOverlap(narration, source);
    expect(result.passed).toBe(false);
  });

  it("does not flag common factual boilerplate in the stoplist", () => {
    const boilerplateSource = "This building was built in 1926 by a local firm of architects working downtown.";
    const narration = "Interestingly, this building was built in 1926, part of a wave of new construction then.";
    expect(checkPhraseOverlap(narration, boilerplateSource).passed).toBe(true);
  });
});

describe("checkLength", () => {
  it("passes a driving-length narration within 60-100 words", () => {
    const narration = Array(80).fill("word").join(" ");
    expect(checkLength(narration, "driving").passed).toBe(true);
  });

  it("fails a driving-length narration that's too short", () => {
    const narration = Array(20).fill("word").join(" ");
    expect(checkLength(narration, "driving").passed).toBe(false);
  });

  it("fails a driving-length narration that's too long", () => {
    const narration = Array(150).fill("word").join(" ");
    expect(checkLength(narration, "driving").passed).toBe(false);
  });

  it("applies the walking target to stationary mode too", () => {
    const narration = Array(270).fill("word").join(" ");
    expect(checkLength(narration, "walking").passed).toBe(true);
    expect(checkLength(narration, "stationary").passed).toBe(true);
  });

  it("uses the wider biking target", () => {
    const narration = Array(160).fill("word").join(" ");
    expect(checkLength(narration, "biking").passed).toBe(true);
    expect(checkLength(narration, "driving").passed).toBe(false);
  });
});

/**
 * PLAN.md §14: "a fixture suite of deliberately hallucinated narrations
 * that must all fail." One base, genuinely grounded narration, then one
 * mutation per failure mode — each mutation must fail `validateGrounding`,
 * and the base must pass it.
 */
describe("validateGrounding — deliberately hallucinated fixture suite", () => {
  const SOURCE_EXCERPT =
    "The Tampa Theatre is a historic movie palace located in downtown Tampa, Florida. It opened in 1926 and was designed in an elaborate atmospheric style, intended to evoke an outdoor Mediterranean courtyard under a starlit sky.";

  const GOOD_NARRATION =
    "Just ahead on your left sits Tampa Theatre, a movie palace dating back to 1926. Step inside and its design plays a bit of a trick on you: you're meant to feel as though you've wandered into an open-air courtyard somewhere along the Mediterranean, complete with a ceiling built to look like a starlit sky overhead. It's one of downtown's older architectural landmarks, and still standing strong nearly a century later.";

  const baseInput = {
    sourceExcerpt: SOURCE_EXCERPT,
    datePrecision: "year" as const,
    spatialFrame: DIRECTIONAL_FRAME,
    mode: "driving" as const,
  };

  it("the base narration is genuinely grounded and passes every check", () => {
    const report = validateGrounding({ ...baseInput, narration: GOOD_NARRATION });
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails an invented date not present in the source", () => {
    const hallucinated = GOOD_NARRATION.replace("1926", "1931");
    const report = validateGrounding({ ...baseInput, narration: hallucinated });
    expect(report.passed).toBe(false);
  });

  it("fails an invented named entity (a fabricated architect)", () => {
    const hallucinated = `${GOOD_NARRATION} It was designed by John Eberson himself.`;
    const report = validateGrounding({ ...baseInput, narration: hallucinated });
    expect(report.passed).toBe(false);
  });

  it("fails a sharpened date when the source's precision is only a decade", () => {
    const report = validateGrounding({
      ...baseInput,
      datePrecision: "decade",
      narration: GOOD_NARRATION, // states "1926" specifically
    });
    expect(report.passed).toBe(false);
  });

  it("fails unwarranted directional language under a regional spatial frame", () => {
    const report = validateGrounding({ ...baseInput, spatialFrame: REGIONAL_FRAME, narration: GOOD_NARRATION });
    expect(report.passed).toBe(false);
  });

  it("fails a narration that mirrors the source's phrasing verbatim", () => {
    const hallucinated =
      "The Tampa Theatre is a historic movie palace located in downtown Tampa, Florida, a real gem of a building.";
    const report = validateGrounding({ ...baseInput, narration: hallucinated });
    expect(report.passed).toBe(false);
  });

  it("fails a narration far outside the mode's length target", () => {
    const tooShort = "Tampa Theatre: a 1926 movie palace.";
    const report = validateGrounding({ ...baseInput, narration: tooShort });
    expect(report.passed).toBe(false);
  });
});
