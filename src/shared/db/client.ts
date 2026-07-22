import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "../config/env";
import * as schema from "./schema";

/**
 * Shared Postgres connection pool + Drizzle client.
 *
 * Postgres is the single stateful dependency for this app (see design.md):
 * app data (this schema) and the pg-boss queue schema coexist in the same
 * database, so this pool's connection string is reused by `shared/jobs/boss.ts`.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
