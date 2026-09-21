import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

/** Creates a drizzle client from a connection string — no implicit env-var fallback, so callers always say explicitly which database they mean. */
export function createDb(connectionString: string) {
  // Postgres's own NOTICE messages (e.g. "truncate cascades to table ...")
  // are routine, not warnings worth logging — silenced rather than left to
  // spam every test run and production log.
  const client = postgres(connectionString, { onnotice: () => {} });
  return drizzle(client, { schema });
}
