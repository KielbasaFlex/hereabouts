/**
 * Premium TTS provider (PLAN.md §9/§12): the free tier's Web Speech API
 * has no server-side equivalent (it's a browser API), so premium natural
 * voices need an actual TTS provider — see `fixtures/README.md` for why
 * that's never been called live in this environment.
 */
export interface TtsProvider {
  synthesize(options: { text: string; voice: string }): Promise<{ audioBytes: Uint8Array; contentType: string }>;
}
