import type { SpatialFrame } from "@hereabouts/core";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  const directional: SpatialFrame = { allow: "directional", distanceM: 20, side: "left" };
  const proximal: SpatialFrame = { allow: "proximal", distanceM: 800, side: null };
  const regional: SpatialFrame = { allow: "regional", distanceM: 12000, side: null };

  it("states the core grounding rule", () => {
    const prompt = buildSystemPrompt({ mode: "walking", spatialFrame: proximal, datePrecision: "year" });
    expect(prompt).toContain("ONLY facts stated in the attached source document");
  });

  it("states the facts-only, non-mirroring instruction", () => {
    const prompt = buildSystemPrompt({ mode: "walking", spatialFrame: proximal, datePrecision: "year" });
    expect(prompt.toLowerCase()).toContain("retell");
    expect(prompt).toContain("own words");
  });

  it("permits directional language only under a directional spatial frame", () => {
    const dirPrompt = buildSystemPrompt({ mode: "walking", spatialFrame: directional, datePrecision: "year" });
    expect(dirPrompt).toContain("may use direct spatial language");

    const regionalPrompt = buildSystemPrompt({ mode: "walking", spatialFrame: regional, datePrecision: "year" });
    expect(regionalPrompt).not.toContain("may use direct spatial language");
    expect(regionalPrompt.toLowerCase()).toContain("never as \"right here\"".toLowerCase());
  });

  it("tells the model not to sharpen a decade-precision date", () => {
    const prompt = buildSystemPrompt({ mode: "walking", spatialFrame: proximal, datePrecision: "decade" });
    expect(prompt.toLowerCase()).toContain("decade");
    expect(prompt.toLowerCase()).toContain("never state a specific year");
  });

  it("embeds the correct word-count target per mode", () => {
    const driving = buildSystemPrompt({ mode: "driving", spatialFrame: proximal, datePrecision: "year" });
    expect(driving).toContain("60-100 words");

    const biking = buildSystemPrompt({ mode: "biking", spatialFrame: proximal, datePrecision: "year" });
    expect(biking).toContain("120-200 words");

    const walking = buildSystemPrompt({ mode: "walking", spatialFrame: proximal, datePrecision: "year" });
    expect(walking).toContain("250-300 words");

    // Stationary shares walking's bucket.
    const stationary = buildSystemPrompt({ mode: "stationary", spatialFrame: proximal, datePrecision: "year" });
    expect(stationary).toContain("250-300 words");
  });

  it("mentions handling difficult history factually", () => {
    const prompt = buildSystemPrompt({ mode: "walking", spatialFrame: proximal, datePrecision: "year" });
    expect(prompt.toLowerCase()).toContain("difficult history");
  });
});
