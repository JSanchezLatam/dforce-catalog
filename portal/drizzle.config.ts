import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next reads .env.local on its own; drizzle-kit does not.
config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
