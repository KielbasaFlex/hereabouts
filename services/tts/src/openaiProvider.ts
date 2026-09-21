import type { TtsProvider } from "./provider.js";

/**
 * OpenAI's TTS endpoint (`POST /v1/audio/speech`) — a stable, documented
 * shape (model + voice + input, mp3 bytes back). `api.openai.com` is
 * blocked by this environment's egress; see `fixtures/README.md`.
 */
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export interface OpenAiTtsOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiTtsProvider(options: OpenAiTtsOptions): TtsProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "tts-1";

  return {
    async synthesize({ text, voice }) {
      const response = await fetchImpl(SPEECH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, voice, input: text }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI TTS request failed: ${response.status} ${response.statusText}`);
      }
      const audioBytes = new Uint8Array(await response.arrayBuffer());
      return { audioBytes, contentType: response.headers.get("content-type") ?? "audio/mpeg" };
    },
  };
}
