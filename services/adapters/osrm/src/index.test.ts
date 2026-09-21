import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fetchRoute, OSRM_DEMO_ENDPOINT } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const ORIGIN = { lat: 27.9506, lon: -82.4572 };
const DESTINATION = { lat: 27.9544, lon: -82.4538 };

describe("fetchRoute", () => {
  it("decodes the geojson geometry into a points array", async () => {
    const fixture = loadFixture("route.json");
    const fetchImpl = vi.fn(async () => jsonResponse(fixture)) as unknown as typeof fetch;

    const route = await fetchRoute({ origin: ORIGIN, destination: DESTINATION, fetchImpl });

    expect(route.points).toEqual([
      { lat: 27.9506, lon: -82.4572 },
      { lat: 27.9518, lon: -82.4561 },
      { lat: 27.9531, lon: -82.4549 },
      { lat: 27.9544, lon: -82.4538 },
    ]);
    expect(route.distanceM).toBe(612.4);
    expect(route.durationS).toBe(98.7);
  });

  it("requests the driving profile with overview=full&geometries=geojson", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/route/v1/driving/-82.4572,27.9506;-82.4538,27.9544");
      expect(parsed.searchParams.get("overview")).toBe("full");
      expect(parsed.searchParams.get("geometries")).toBe("geojson");
      return jsonResponse(loadFixture("route.json"));
    }) as unknown as typeof fetch;

    await fetchRoute({ origin: ORIGIN, destination: DESTINATION, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("defaults to the documented OSRM demo endpoint", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url).startsWith(OSRM_DEMO_ENDPOINT)).toBe(true);
      return jsonResponse(loadFixture("route.json"));
    }) as unknown as typeof fetch;
    await fetchRoute({ origin: ORIGIN, destination: DESTINATION, fetchImpl });
  });

  it("uses a custom endpoint when given one (self-hosted OSRM)", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url).startsWith("https://osrm.internal.example")).toBe(true);
      return jsonResponse(loadFixture("route.json"));
    }) as unknown as typeof fetch;
    await fetchRoute({ origin: ORIGIN, destination: DESTINATION, endpoint: "https://osrm.internal.example", fetchImpl });
  });

  it("throws with OSRM's own code/message on a NoRoute response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(loadFixture("no-route.json"))) as unknown as typeof fetch;
    await expect(fetchRoute({ origin: ORIGIN, destination: DESTINATION, fetchImpl })).rejects.toThrow(/NoRoute/);
  });

  it("throws a descriptive error on a non-OK HTTP response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }),
    ) as unknown as typeof fetch;
    await expect(fetchRoute({ origin: ORIGIN, destination: DESTINATION, fetchImpl })).rejects.toThrow(/503/);
  });
});
