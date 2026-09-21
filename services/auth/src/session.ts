import { randomBytes } from "node:crypto";
import type { Db } from "@hereabouts/db";
import { sessions, users } from "@hereabouts/db";
import { eq } from "drizzle-orm";

/**
 * Hand-rolled server-side sessions, not Auth.js's own wire protocol
 * (session/JWT cookie format, CSRF double-submit, `/auth/callback/*`
 * routes). PLAN.md §12 names Auth.js, but Auth.js's client-side pieces
 * (CSRF-token fetching, cookie handling) are built assuming its own
 * `next-auth/react`-style client or a framework adapter — neither exists
 * for this stack (Hono + a hand-rolled Vite/React client), and
 * hand-implementing Auth.js's wire protocol *without* that client is a
 * real security-bug risk (getting CSRF or cookie flags subtly wrong) for
 * no benefit over a small, fully-understood, fully-tested session system
 * built directly against this app's own two real credential paths
 * (email+password, unverified-live OAuth). See `PLAN.md`'s Milestone 6
 * caveats for the full reasoning.
 *
 * A session token is a random opaque string (not a JWT) stored in
 * Postgres — revocable by deleting the row, which a JWT can't offer
 * without a denylist.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface Session {
  token: string;
  expiresAt: Date;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(db: Db, userId: string): Promise<Session> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the session's user, or `null` for a missing/expired token — never throws for an invalid token. */
export async function validateSession(db: Db, token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token));

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await invalidateSession(db, token); // lazy cleanup of an expired session
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}
