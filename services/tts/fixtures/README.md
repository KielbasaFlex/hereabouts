# Verification status

**`api.openai.com` and `api.elevenlabs.io` are both blocked** by this
environment's egress proxy (confirmed directly, same 403-at-CONNECT
treatment as `api.stripe.com`). `createOpenAiTtsProvider` is unit-tested
against the documented `POST /v1/audio/speech` request/response shape
(model + voice + input in, raw audio bytes back) but has never made a real
call — no real audio has ever been synthesized in this environment.

`LocalFileAudioStorage` is different: it's real, working local filesystem
I/O, tested against a real temp directory, not a mock. It's a placeholder
for production object storage (S3/R2/GCS), not for something unreachable.

**Before this is considered done**, with a real `OPENAI_API_KEY`:

1. Synthesize a short real narration and confirm the returned bytes are a
   playable MP3 (open it, don't just check the byte count).
2. Confirm error responses (bad API key, invalid voice name) come back
   with OpenAI's actual documented error shape, not just a bare non-200.
3. Swap `LocalFileAudioStorage` for a real object-storage-backed
   `AudioStorage` before any production deploy — the local filesystem
   doesn't survive a redeploy or scale past one instance.
