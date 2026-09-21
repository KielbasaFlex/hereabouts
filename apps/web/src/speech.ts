import type { PlaybackSink } from "@hereabouts/core/playback";

/**
 * Thin wrapper over the Web Speech API — the free-tier voice (PLAN.md §9).
 * `SpeechController` is a type alias for `packages/core`'s platform-agnostic
 * `PlaybackSink` interface: a native TTS plugin (`apps/native`, Milestone 7)
 * implements the same interface, so nothing that calls `SpeechController`
 * needs to change when the audio sink is swapped for a native one.
 */
export type SpeechController = PlaybackSink;

export function createSpeechController(): SpeechController {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  return {
    isSupported: () => supported,

    speak(text, onEnd) {
      if (!supported) return;
      window.speechSynthesis.cancel(); // never overlap two stories
      const utterance = new SpeechSynthesisUtterance(text);
      if (onEnd) utterance.onend = () => onEnd();
      window.speechSynthesis.speak(utterance);
    },

    pause() {
      if (supported) window.speechSynthesis.pause();
    },

    resume() {
      if (supported) window.speechSynthesis.resume();
    },

    cancel() {
      if (supported) window.speechSynthesis.cancel();
    },
  };
}
