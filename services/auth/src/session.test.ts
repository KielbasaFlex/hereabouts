import { createDb, users, type Db } from "@hereabouts/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, invalidateSession, validateSession } from "./session.js";

/** Real integration tests against a real local Postgres — same requirement/setup as `packages/db`'s own tests. */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts_test";

let db: Db;

beforeEach(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  const client = (db as unknown as { $client: { end: () => Promise<void> } }).$client;
  await client.end();
});

async function makeUser(email = "a@example.com") {
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  return user!.id;
}

describe("session", () => {
  it("creates a session that validates back to the same user", async () => {
    const userId = await makeUser();
    const session = await createSession(db, userId);

    const found = await validateSession(db, session.token);
    expect(found?.id).toBe(userId);
    expect(found?.email).toBe("a@example.com");
  });

  it("returns null for an unknown token", async () => {
    expect(await validateSession(db, "not-a-real-token")).toBeNull();
  });

  it("returns null and cleans up an expired session", async () => {
    const userId = await makeUser();
    const session = await createSession(db, userId);

    // Force it into the past directly — createSession always issues a
    // future expiry, so this simulates 30 days having passed.
    await db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token = ${session.token}`);

    expect(await validateSession(db, session.token)).toBeNull();

    // Lazy cleanup: the expired row should be gone after validation.
    const remaining = await db.execute(sql`SELECT 1 FROM sessions WHERE token = ${session.token}`);
    expect(remaining.length).toBe(0);
  });

  it("invalidateSession logs a session out immediately", async () => {
    const userId = await makeUser();
    const session = await createSession(db, userId);
    await invalidateSession(db, session.token);
    expect(await validateSession(db, session.token)).toBeNull();
  });

  it("issues a distinct token for each session", async () => {
    const userId = await makeUser();
    const a = await createSession(db, userId);
    const b = await createSession(db, userId);
    expect(a.token).not.toBe(b.token);
  });
});
