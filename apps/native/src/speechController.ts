import type { PlaybackSink } from "@hereabouts/core/playback";
import { QueueStrategy, type TextToSpeechPlugin } from "@capacitor-community/text-to-speech";

/**
 * `PlaybackSink` backed by `@capacitor-community/text-to-speech`'s native
 * TTS engine (PLAN.md §10, Milestone 7's "background audio" exit
 * criterion). Structurally a drop-in replacement for
 * `apps/web/src/speech.ts`'s Web Speech implementation — same interface,
 * same "cancel before speaking so two stories never overlap" behavior —
 * with zero changes needed in `packages/core` or in whatever calls
 * `PlaybackSink`.
 *
 * Honest limitation, not simplified away: the plugin's native API
 * (`speak`/`stop` only, confirmed from its installed `.d.ts`) has no
 * pause/resume primitive, unlike `window.speechSynthesis`. `pause()` stops
 * playback outright; `resume()` cannot continue from the paused point and
 * is a documented no-op here. See `apps/native/README.md`.
 */
export class CapacitorSpeechController implements PlaybackSink {
  private speaking = false;

  constructor(private readonly plugin: TextToSpeechPlugin) {}

  isSupported(): boolean {
    return true;
  }

  speak(text: string, onEnd?: () => void): void {
    this.plugin
      .stop() // never overlap two stories, matching the web SpeechController
      .then(() =>
        this.plugin.speak({
          text,
          category: "playback", // survives the app being backgrounded on iOS
          queueStrategy: QueueStrategy.Flush,
        }),
      )
      .then(() => {
        this.speaking = false;
        onEnd?.();
      })
      .catch(() => {
        this.speaking = false;
      });
    this.speaking = true;
  }

  pause(): void {
    if (!this.speaking) return;
    this.speaking = false;
    void this.plugin.stop();
  }

  resume(): void {
    // No native resume primitive exists on this plugin — see class doc.
  }

  cancel(): void {
    this.speaking = false;
    void this.plugin.stop();
  }
}
