import { createDb, users, type Db } from "@hereabouts/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EmailAlreadyRegisteredError, InvalidCredentialsError, login, signUp } from "./credentials.js";
import { validateSession } from "./session.js";

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

describe("signUp", () => {
  it("creates a user with a hashed (not plaintext) password and returns a working session", async () => {
    const session = await signUp(db, "new@example.com", "hunter2");

    const [user] = await db.select().from(users).where(eq(users.email, "new@example.com"));
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain("hunter2");

    const sessionUser = await validateSession(db, session.token);
    expect(sessionUser?.email).toBe("new@example.com");
  });

  it("rejects a second signup with the same email", async () => {
    await signUp(db, "dup@example.com", "password1");
    await expect(signUp(db, "dup@example.com", "password2")).rejects.toThrow(EmailAlreadyRegisteredError);
  });
});

describe("login", () => {
  it("logs in with the correct password", async () => {
    await signUp(db, "user@example.com", "correct-password");
    const session = await login(db, "user@example.com", "correct-password");
    const sessionUser = await validateSession(db, session.token);
    expect(sessionUser?.email).toBe("user@example.com");
  });

  it("rejects an incorrect password", async () => {
    await signUp(db, "user@example.com", "correct-password");
    await expect(login(db, "user@example.com", "wrong-password")).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects a login for an email that was never registered", async () => {
    await expect(login(db, "nobody@example.com", "anything")).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects a password login for an OAuth-only account (no password set)", async () => {
    await db.insert(users).values({ email: "oauth-only@example.com" }); // no passwordHash
    await expect(login(db, "oauth-only@example.com", "anything")).rejects.toThrow(InvalidCredentialsError);
  });
});
