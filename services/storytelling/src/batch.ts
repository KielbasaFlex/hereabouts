import type Anthropic from "@anthropic-ai/sdk";
import type { LengthBucket, PlaceEvent, Story } from "@hereabouts/contracts";
import { validateGrounding, type Mode, type SpatialFrame } from "@hereabouts/core";
import type { StoryCache } from "./cache.js";
import { finalizeNarration } from "./finalize.js";
import { buildGenerationRequestParams, extractNarration, GENERATION_MODEL, type GeneratedNarration } from "./generate.js";
import { PROMPT_VERSION } from "./prompt.js";

/**
 * Batch API pre-generation (PLAN.md §11 step 3): generate stories for a
 * whole route corridor in one asynchronous batch, at 50% of the live
 * per-request cost — "latency irrelevant here" is the brief's own framing,
 * since a route pack is downloaded well before the trip starts.
 *
 * This deliberately makes **one** generation attempt per place, unlike
 * `build-story.ts`'s live path (which regenerates once on a failed Layer 2
 * check): a Batch API "retry" is a whole second batch submission, not a
 * quick in-request retry, so the cost/latency tradeoff is different enough
 * that this module doesn't try to replicate the live path's retry policy —
 * a place that fails Layer 2 here goes straight to the same grounded
 * template fallback every other failure path uses. See the Milestone 5
 * caveats in `PLAN.md` for why this is an accepted simplification, not an
 * oversight.
 */

export interface BatchPlaceInput {
  place: PlaceEvent;
  mode: Mode;
  spatialFrame: SpatialFrame;
}

function toLengthBucket(mode: Mode): LengthBucket {
  if (mode === "driving") return "driving";
  if (mode === "biking") return "biking";
  return "walking";
}

export interface SubmitBatchOptions {
  inputs: readonly BatchPlaceInput[];
  client: Pick<Anthropic, "messages">;
}

/** Submits one Batch API request per place, keyed by `custom_id: place.id`. Returns the batch id. */
export async function submitBatch(options: SubmitBatchOptions): Promise<string> {
  const requests = options.inputs.map((input) => ({
    custom_id: input.place.id,
    params: buildGenerationRequestParams(input),
  }));
  const batch = await options.client.messages.batches.create({ requests });
  return batch.id;
}

export interface PollBatchOptions {
  batchId: string;
  client: Pick<Anthropic, "messages">;
  /** Injectable for tests, so polling doesn't depend on real timers. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Safety bound on polling attempts, not a promise about total wait time — see `pollIntervalMs`. */
  maxAttempts?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 1440; // 24h at the default 1-minute interval — the Batches API's own documented max turnaround

/** Polls `messages.batches.retrieve` until `processing_status` is `"ended"`. */
export async function pollBatchUntilDone(options: PollBatchOptions) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const batch = await options.client.messages.batches.retrieve(options.batchId);
    if (batch.processing_status === "ended") return batch;
    await sleep(pollIntervalMs);
  }
  throw new Error(`Batch ${options.batchId} did not finish within ${maxAttempts} polling attempts`);
}

export interface GenerateStoriesViaBatchOptions {
  inputs: readonly BatchPlaceInput[];
  client: Pick<Anthropic, "messages">;
  cache: StoryCache;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

/**
 * The full batch pipeline: submit → poll → for each result, validate
 * (Layer 2) → judge/fallback (Layer 3, via the same `finalizeNarration`
 * the live path uses) → cache. Populating the same `StoryCache` the live
 * `/story` endpoint reads from means a place from a downloaded pack that
 * the listener later passes live is already a cache hit — the whole point
 * of a *shared* cache (PLAN.md §4.4).
 *
 * Returns one `Story` per input, in the same order as `inputs` — batch
 * results themselves arrive in arbitrary order (keyed by `custom_id`), so
 * this re-sorts them back into request order for a stable pack.
 */
export async function generateStoriesViaBatch(options: GenerateStoriesViaBatchOptions): Promise<Story[]> {
  if (options.inputs.length === 0) return [];

  const inputsById = new Map(options.inputs.map((input) => [input.place.id, input]));
  const groundedById = new Map<string, GeneratedNarration | null>();

  // A thrown error anywhere in submit/poll/results — including the SDK's
  // own client-side auth check rejecting a missing API key before any
  // network round trip — is treated the same as every place's batch
  // request having failed, not surfaced as a whole-pack failure. Whatever
  // was already parsed into `groundedById` before a mid-iteration failure
  // is still used; anything missing falls back to the template card below,
  // same "degrade, never fail the request" posture as `build-story.ts`.
  try {
    const batchId = await submitBatch({ inputs: options.inputs, client: options.client });
    await pollBatchUntilDone({
      batchId,
      client: options.client,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    });

    for await (const result of await options.client.messages.batches.results(batchId)) {
      const input = inputsById.get(result.custom_id);
      if (!input) continue; // defensive: a custom_id this call never submitted

      if (result.result.type !== "succeeded") {
        groundedById.set(result.custom_id, null);
        continue;
      }

      const { narration, citations } = extractNarration(result.result.message.content);
      const report = validateGrounding({
        narration,
        sourceExcerpt: input.place.sourceExcerpt,
        datePrecision: input.place.datePrecision,
        spatialFrame: input.spatialFrame,
        mode: input.mode,
      });
      groundedById.set(result.custom_id, report.passed ? { narration, citations, model: GENERATION_MODEL } : null);
    }
  } catch (error) {
    console.warn("storytelling: batch generation failed, falling back to the template card for every place:", error);
  }

  const stories: Story[] = [];
  for (const input of options.inputs) {
    const lengthBucket = toLengthBucket(input.mode);
    const finalized = await finalizeNarration({
      place: input.place,
      groundedGenerated: groundedById.get(input.place.id) ?? null,
      client: options.client,
    });

    options.cache.set({ placeId: input.place.id, lengthBucket, promptVersion: PROMPT_VERSION }, finalized);
    stories.push({ placeId: input.place.id, lengthBucket, promptVersion: PROMPT_VERSION, cached: false, ...finalized });
  }

  return stories;
}
