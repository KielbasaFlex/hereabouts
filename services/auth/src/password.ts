import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing (PLAN.md §12's "email + social"). Argon2id via
 * `@node-rs/argon2` — a real native binding (verified working in this
 * environment), not a placeholder.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
