import type { Db } from "@hereabouts/db";
import type { Session, SessionUser } from "@hereabouts/auth";
import { validateSession } from "@hereabouts/auth";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * Cookie plumbing for the hand-rolled session system (`@hereabouts/auth`'s
 * own doc comment explains why this isn't Auth.js's own cookie protocol).
 * `secure` is conditional on `NODE_ENV=production` — the dev server runs
 * over plain HTTP on localhost, where a `Secure` cookie would silently
 * never be set at all.
 */
export const SESSION_COOKIE_NAME = "hereabouts_session";

export function setSessionCookie(c: Context, session: Session): void {
  setCookie(c, SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

/** Reads and validates the session cookie, if any — returns `null` for a missing or invalid/expired session, never throws. */
export async function getSessionUser(c: Context, db: Db): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;
  return validateSession(db, token);
}
