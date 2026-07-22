import "dotenv/config";

import { defineConfig } from "drizzle-kit";

import { env } from "./src/shared/config/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./src/shared/db/migrations",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
