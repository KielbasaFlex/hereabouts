import { describe, expect, it, vi } from "vitest";
import type { TextToSpeechPlugin } from "@capacitor-community/text-to-speech";
import { CapacitorSpeechController } from "./speechController.js";

function fakePlugin(): TextToSpeechPlugin {
  return {
    speak: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getSupportedLanguages: vi.fn(),
    getSupportedVoices: vi.fn(),
    isLanguageSupported: vi.fn(),
    openInstall: vi.fn(),
    addListener: vi.fn(),
  } as unknown as TextToSpeechPlugin;
}

describe("CapacitorSpeechController", () => {
  it("isSupported is always true (native TTS has no browser-support gate)", () => {
    expect(new CapacitorSpeechController(fakePlugin()).isSupported()).toBe(true);
  });

  it("speak() stops any prior utterance before starting a new one", async () => {
    const plugin = fakePlugin();
    const controller = new CapacitorSpeechController(plugin);
    controller.speak("hello");
    await Promise.resolve();
    await Promise.resolve();
    expect(plugin.stop).toHaveBeenCalled();
    expect(plugin.speak).toHaveBeenCalledWith(expect.objectContaining({ text: "hello", category: "playback" }));
  });

  it("speak() calls onEnd once the native speak() promise resolves", async () => {
    const plugin = fakePlugin();
    const controller = new CapacitorSpeechController(plugin);
    const onEnd = vi.fn();
    controller.speak("hello", onEnd);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled());
  });

  it("cancel() calls the plugin's stop()", () => {
    const plugin = fakePlugin();
    const controller = new CapacitorSpeechController(plugin);
    controller.cancel();
    expect(plugin.stop).toHaveBeenCalled();
  });

  it("pause() stops playback outright (no native pause/resume primitive exists)", () => {
    const plugin = fakePlugin();
    const controller = new CapacitorSpeechController(plugin);
    controller.speak("hello");
    controller.pause();
    expect(plugin.stop).toHaveBeenCalled();
  });

  it("resume() is a documented no-op", () => {
    const plugin = fakePlugin();
    const controller = new CapacitorSpeechController(plugin);
    expect(() => controller.resume()).not.toThrow();
    expect(plugin.speak).not.toHaveBeenCalled();
  });
});
