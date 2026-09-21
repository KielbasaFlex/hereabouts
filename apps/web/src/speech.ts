/**
 * Thin wrapper over the Web Speech API — the free-tier voice (PLAN.md §9).
 * Server-side premium TTS (Milestone 6) sits behind this same interface
 * later, choosing an audio-element-based implementation instead; nothing
 * that calls `SpeechController` needs to change.
 */
export interface SpeechController {
  isSupported(): boolean;
  speak(text: string, onEnd?: () => void): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

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
