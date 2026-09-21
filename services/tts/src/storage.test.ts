import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileAudioStorage } from "./storage.js";

let dir: string;
let storage: LocalFileAudioStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hereabouts-audio-"));
  storage = new LocalFileAudioStorage(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalFileAudioStorage", () => {
  it("stores and retrieves bytes with their content type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { url } = await storage.put("story-1.mp3", bytes, "audio/mpeg");

    expect(url).toBe("/audio/story-1.mp3");
    const found = await storage.get("story-1.mp3");
    expect(found?.bytes).toEqual(bytes);
    expect(found?.contentType).toBe("audio/mpeg");
  });

  it("returns null for a key that was never stored", async () => {
    expect(await storage.get("nope.mp3")).toBeNull();
  });

  it("creates the target directory if it doesn't exist yet", async () => {
    const nested = new LocalFileAudioStorage(join(dir, "nested", "path"));
    await nested.put("a.mp3", new Uint8Array([1]), "audio/mpeg");
    expect((await nested.get("a.mp3"))?.bytes).toEqual(new Uint8Array([1]));
  });

  it("overwrites existing content stored under the same key", async () => {
    await storage.put("story-1.mp3", new Uint8Array([1]), "audio/mpeg");
    await storage.put("story-1.mp3", new Uint8Array([2, 2]), "audio/wav");
    const found = await storage.get("story-1.mp3");
    expect(found?.bytes).toEqual(new Uint8Array([2, 2]));
    expect(found?.contentType).toBe("audio/wav");
  });

  it("uses a custom URL prefix when given one", async () => {
    const custom = new LocalFileAudioStorage(dir, "/premium-audio");
    const { url } = await custom.put("x.mp3", new Uint8Array([1]), "audio/mpeg");
    expect(url).toBe("/premium-audio/x.mp3");
  });
});
