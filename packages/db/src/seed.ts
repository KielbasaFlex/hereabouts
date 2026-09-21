import { createDb } from "./client.js";
import { tierLimits } from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed the database");

const db = createDb(connectionString);

/**
 * Default tier rows (PLAN.md §12). These are the *seed defaults*, not
 * hard-coded limits — the whole point of `tier_limits` being a table is
 * that an operator can update these numbers with a plain SQL statement,
 * no deploy required.
 */
await db
  .insert(tierLimits)
  .values([
    { tier: "free", dailyStoryCap: 20, premiumVoices: false, routePacks: false, tripLog: true },
    { tier: "premium", dailyStoryCap: null, premiumVoices: true, routePacks: true, tripLog: true },
  ])
  .onConflictDoNothing();

console.log("seeded tier_limits");
process.exit(0);
