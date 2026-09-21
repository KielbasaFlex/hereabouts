import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Milestone 6's persistence layer (PLAN.md §4.6/§12): the first real
 * Postgres usage in this codebase. Everything through Milestone 5 was
 * deliberately stateless/in-memory (no account system needed one) — a
 * commerce milestone is the first thing that genuinely can't work without
 * durable, relational state (a subscription has to survive a server
 * restart), so this is where Postgres actually gets wired up rather than
 * staying a `docker-compose.yml` service nothing connects to.
 *
 * Scope note: only the account/billing tables PLAN.md §4.6 lists are here.
 * `place_event`/`coverage_cell`/`story` (§4.1/§4.3/§4.4) stay in-memory —
 * migrating those is a separate, content-pipeline concern this milestone
 * doesn't touch, not an oversight.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  /** Null for an OAuth-only account that never set a password. */
  passwordHash: text("password_hash"),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

/**
 * Linked OAuth identities (PLAN.md §12 "email + social"). One row per
 * provider a user has connected — a user can have a password *and* one or
 * more linked accounts.
 */
export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "google" | "github"
  providerAccountId: text("provider_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerAccountIdx: uniqueIndex("oauth_accounts_provider_idx").on(table.provider, table.providerAccountId),
}));

/**
 * Server-side sessions: the token itself (a random string, not a JWT) is
 * what's stored in the browser's httpOnly cookie — see `services/auth`'s
 * doc comment for why this codebase hand-rolls a small session system
 * rather than adopting Auth.js's own wire protocol.
 */
export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stripe mirror (PLAN.md §4.6) — one row per user who has ever started a subscription. */
export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status").notNull(), // "active" | "past_due" | "canceled" | "incomplete" | ...
  tier: text("tier").notNull().default("free"), // "free" | "premium"
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tier limits as **rows, not constants** (PLAN.md §12's explicit brief
 * requirement: "configurable, not hard-coded") — changing a limit is a
 * data update, not a deploy.
 */
export const tierLimits = pgTable("tier_limits", {
  tier: text("tier").primaryKey(), // "free" | "premium"
  /** Null means unlimited — premium's row. */
  dailyStoryCap: integer("daily_story_cap"),
  premiumVoices: boolean("premium_voices").notNull().default(false),
  routePacks: boolean("route_packs").notNull().default(false),
  tripLog: boolean("trip_log").notNull().default(false),
});

/** Append-only usage meter (PLAN.md §12) — the record a daily cap check and a billing dispute both read from. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "story_generated" | "story_served" | "tts_seconds"
  costMicros: integer("cost_micros").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
