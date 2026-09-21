import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter, RedisRateLimiter } from "./rateLimiter.js";

describe("InMemoryRateLimiter", () => {
  it("increments and returns the running count for a key", async () => {
    const limiter = new InMemoryRateLimiter();
    expect(await limiter.increment("a", 60)).toBe(1);
    expect(await limiter.increment("a", 60)).toBe(2);
    expect(await limiter.increment("a", 60)).toBe(3);
  });

  it("tracks separate keys independently", async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.increment("a", 60);
    expect(await limiter.increment("b", 60)).toBe(1);
  });
});

/**
 * Real integration test against a real local Redis (started for this
 * session — see `PLAN.md`'s Milestone 6 section). Not mocked: this is the
 * actual `INCR`/`EXPIRE` pair the production rate limiter runs.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1"; // db 1, kept separate from any dev usage on db 0

describe("RedisRateLimiter", () => {
  const redis = new Redis(REDIS_URL);

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("increments a real Redis counter and returns the running count", async () => {
    const limiter = new RedisRateLimiter(redis);
    expect(await limiter.increment("test:key", 60)).toBe(1);
    expect(await limiter.increment("test:key", 60)).toBe(2);

    const raw = await redis.get("test:key");
    expect(raw).toBe("2");
  });

  it("sets a TTL on the first increment so the key expires", async () => {
    const limiter = new RedisRateLimiter(redis);
    await limiter.increment("test:ttl-key", 3600);
    const ttl = await redis.ttl("test:ttl-key");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it("does not reset the TTL on subsequent increments", async () => {
    const limiter = new RedisRateLimiter(redis);
    await limiter.increment("test:ttl-key", 3600);
    await redis.expire("test:ttl-key", 10); // simulate time having passed
    await limiter.increment("test:ttl-key", 3600);
    const ttl = await redis.ttl("test:ttl-key");
    expect(ttl).toBeLessThanOrEqual(10);
  });
});
