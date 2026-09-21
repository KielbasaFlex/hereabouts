import { describe, expect, it, vi } from "vitest";
import { createOpenAiTtsProvider } from "./openaiProvider.js";

function audioResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
}

describe("createOpenAiTtsProvider", () => {
  it("returns the audio bytes and content type from a successful response", async () => {
    const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // fake MP3-ish header bytes
    const fetchImpl = vi.fn(async () => audioResponse(fakeAudio)) as unknown as typeof fetch;
    const provider = createOpenAiTtsProvider({ apiKey: "sk-fake", fetchImpl });

    const result = await provider.synthesize({ text: "Hello, world.", voice: "alloy" });

    expect(result.audioBytes).toEqual(fakeAudio);
    expect(result.contentType).toBe("audio/mpeg");
  });

  it("sends the model/voice/input in the request body with a Bearer auth header", async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-fake");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ model: "tts-1", voice: "alloy", input: "Hello, world." });
      return audioResponse(new Uint8Array([1]));
    }) as unknown as typeof fetch;

    const provider = createOpenAiTtsProvider({ apiKey: "sk-fake", fetchImpl });
    await provider.synthesize({ text: "Hello, world.", voice: "alloy" });
  });

  it("respects a custom model override", async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("tts-1-hd");
      return audioResponse(new Uint8Array([1]));
    }) as unknown as typeof fetch;

    const provider = createOpenAiTtsProvider({ apiKey: "sk-fake", model: "tts-1-hd", fetchImpl });
    await provider.synthesize({ text: "x", voice: "alloy" });
  });

  it("throws a descriptive error on a non-OK response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }),
    ) as unknown as typeof fetch;
    const provider = createOpenAiTtsProvider({ apiKey: "sk-bad", fetchImpl });

    await expect(provider.synthesize({ text: "x", voice: "alloy" })).rejects.toThrow(/401/);
  });
});
