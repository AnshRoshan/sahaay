import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
// `generate` only diffs the schema against the local snapshots in ./drizzle and needs no
// database; every other command must target the same URL the app uses. A hardcoded local URL
// here once pushed schema changes into a development database while the app pointed elsewhere.
if (!url && !process.argv.includes("generate")) {
  throw new Error("DATABASE_URL is not set. Export it (or put it in .env) before running drizzle-kit.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
});
