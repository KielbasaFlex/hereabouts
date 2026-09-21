import { defineConfig } from "drizzle-kit";

/** `DATABASE_URL` is required to *generate/run* migrations; the app itself always takes a connection string explicitly (see `src/client.ts`). */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://hereabouts:hereabouts@localhost:5432/hereabouts",
  },
});
