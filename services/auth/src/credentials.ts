import type { Db } from "@hereabouts/db";
import { users } from "@hereabouts/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, type Session } from "./session.js";

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("email already registered");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

/** Creates a new user with a hashed password and an immediate session — throws {@link EmailAlreadyRegisteredError} on a duplicate email. */
export async function signUp(db: Db, email: string, password: string): Promise<Session> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length > 0) throw new EmailAlreadyRegisteredError();

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
  return createSession(db, user!.id);
}

/**
 * Verifies email+password and starts a session — throws
 * {@link InvalidCredentialsError} for either a wrong password or an
 * OAuth-only account with no password set, deliberately not distinguishing
 * the two in the error (never confirm whether an email is registered).
 */
export async function login(db: Db, email: string, password: string): Promise<Session> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !user.passwordHash) throw new InvalidCredentialsError();

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) throw new InvalidCredentialsError();

  return createSession(db, user.id);
}
