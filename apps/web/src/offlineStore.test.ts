import type { RoutePack } from "@hereabouts/contracts";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteRoutePack, listRoutePacks, loadRoutePack, saveRoutePack } from "./offlineStore.js";

function pack(packId: string): RoutePack {
  return {
    packId,
    mode: "walking",
    route: { points: [{ lat: 0, lon: 0 }], distanceM: 0, durationS: 0 },
    places: [],
    stories: [],
    tiles: [],
    attribution: [],
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

let factory: IDBFactory;

beforeEach(() => {
  // A fresh in-memory database per test — fake-indexeddb's exported
  // `indexedDB` is a shared singleton, so tests construct their own
  // factory instance instead of leaking state across tests.
  factory = new IDBFactory();
});

describe("offlineStore", () => {
  it("returns an empty list when nothing has been saved", async () => {
    expect(await listRoutePacks(factory)).toEqual([]);
  });

  it("saves and loads a pack by id", async () => {
    await saveRoutePack(pack("pack-1"), factory);
    const loaded = await loadRoutePack("pack-1", factory);
    expect(loaded?.packId).toBe("pack-1");
  });

  it("returns undefined for a pack id that was never saved", async () => {
    expect(await loadRoutePack("nope", factory)).toBeUndefined();
  });

  it("lists every saved pack", async () => {
    await saveRoutePack(pack("pack-1"), factory);
    await saveRoutePack(pack("pack-2"), factory);
    const all = await listRoutePacks(factory);
    expect(all.map((p) => p.packId).sort()).toEqual(["pack-1", "pack-2"]);
  });

  it("overwrites a pack saved again under the same id", async () => {
    await saveRoutePack(pack("pack-1"), factory);
    const updated: RoutePack = { ...pack("pack-1"), attribution: ["Updated"] };
    await saveRoutePack(updated, factory);

    const all = await listRoutePacks(factory);
    expect(all).toHaveLength(1);
    expect(all[0]?.attribution).toEqual(["Updated"]);
  });

  it("deletes a pack, a hard delete matching the trip log's own posture", async () => {
    await saveRoutePack(pack("pack-1"), factory);
    await deleteRoutePack("pack-1", factory);
    expect(await loadRoutePack("pack-1", factory)).toBeUndefined();
  });

  it("persists across separate calls against the same factory (same underlying database)", async () => {
    await saveRoutePack(pack("pack-1"), factory);
    // A brand new factory is a brand new (empty) database — proves this
    // isn't accidentally reading from some other shared/global state.
    const otherFactory = new IDBFactory();
    expect(await listRoutePacks(otherFactory)).toEqual([]);
    expect(await listRoutePacks(factory)).toHaveLength(1);
  });
});
