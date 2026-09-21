import type { Redis } from "ioredis";

/**
 * A minimal fixed-window counter — enough for "how many of X has this key
 * done today," which is what PLAN.md §12's daily caps and global ceiling
 * actually need. Not a smooth token bucket (which trades off burst
 * *rate*, not a daily quota) — see `usage.ts`'s doc comment for why a
 * fixed daily window is the more direct fit for "daily story cap."
 */
export interface RateLimiter {
  /** Increments the counter for `key` and returns the new count. The first increment for a fresh key sets its TTL to `windowSeconds`. */
  increment(key: string, windowSeconds: number): Promise<number>;
}

/** In-process, for unit tests — no real Redis needed. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  // windowSeconds is part of the RateLimiter contract but unused here —
  // an in-memory counter has no expiry mechanism; it lives only as long
  // as the test process does.
  async increment(key: string, _windowSeconds: number): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

/** Real Redis-backed counter — verified live against a local Redis instance in this session. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Pick<Redis, "incr" | "expire">) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }
}
