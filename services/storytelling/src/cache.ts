import type { Citation, LengthBucket, ValidationStatus } from "@hereabouts/contracts";

/**
 * The shared story cache (PLAN.md §4.4/§8.4): "a story generated for a
 * place/length combination is cached globally and reused for every user."
 * This is the main cost control, so the interface is designed in from day
 * one — but the implementation below is in-memory only.
 *
 * **Not persisted across restarts.** PLAN.md's target is a Postgres-backed
 * `story` table (§4.4), keyed exactly the same way. There's still no
 * Postgres wiring in this codebase (a Milestone 2 caveat that carries
 * forward), so `InMemoryStoryCache` is a placeholder that gets the
 * *interface and cache-key design* right without the persistence — nothing
 * that calls `StoryCache` needs to change when a Postgres-backed
 * implementation replaces this one.
 */

export interface StoryCacheKey {
  /** The place (or, once clustering feeds this, cluster) id — PLAN.md's `cluster_id`. */
  placeId: string;
  lengthBucket: LengthBucket;
  /** From `prompt.ts`'s `PROMPT_VERSION` — a prompt edit is a new cache generation. */
  promptVersion: string;
}

export interface StoryCacheEntry {
  narration: string;
  citations: Citation[];
  validationStatus: ValidationStatus;
  model: string;
}

export interface StoryCache {
  get(key: StoryCacheKey): StoryCacheEntry | undefined;
  set(key: StoryCacheKey, entry: StoryCacheEntry): void;
}

function keyToString(key: StoryCacheKey): string {
  return `${key.placeId}::${key.lengthBucket}::${key.promptVersion}`;
}

export class InMemoryStoryCache implements StoryCache {
  private readonly store = new Map<string, StoryCacheEntry>();

  get(key: StoryCacheKey): StoryCacheEntry | undefined {
    return this.store.get(keyToString(key));
  }

  set(key: StoryCacheKey, entry: StoryCacheEntry): void {
    this.store.set(keyToString(key), entry);
  }

  /** Test/ops convenience — not part of the `StoryCache` interface. */
  get size(): number {
    return this.store.size;
  }
}
