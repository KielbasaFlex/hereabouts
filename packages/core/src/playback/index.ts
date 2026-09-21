/**
 * A narration audio sink (PLAN.md §2.1, §10). The browser's Web Speech API
 * (`apps/web/src/speech.ts`) and a native TTS plugin (`apps/native`,
 * Milestone 7) are both just implementations of this interface — nothing
 * downstream of a `PlaybackSink` (the scheduler, the narration trigger
 * logic) touches `window.speechSynthesis` or a Capacitor plugin directly,
 * which is what makes "swap the audio sink" a real, checkable claim rather
 * than a comment.
 */
export interface PlaybackSink {
  isSupported(): boolean;
  speak(text: string, onEnd?: () => void): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}
