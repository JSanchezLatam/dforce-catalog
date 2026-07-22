import { PgBoss } from "pg-boss";

import { env } from "../config/env";

/**
 * pg-boss bootstrap — singleton instance shared by every queue producer/worker.
 *
 * Reuses the same Postgres connection string as Drizzle (see design.md →
 * "Technical Approach": Postgres is the single stateful dependency; app data
 * and the pg-boss queue schema coexist). pg-boss manages its own `pgboss`
 * schema and migrations on `start()`.
 *
 * No job definitions live here yet — `send()`/`work()` calls for
 * `inventory-sync`, `pdf-generate`, and `pdf-upload` are added in later PRs
 * alongside the modules that own them.
 */

let bossPromise: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: env.DATABASE_URL });
      boss.on("error", (error) => {
        // Never log env.DATABASE_URL or any queue payload that might carry
        // secrets — see SENSITIVE_ENV_KEYS in shared/config/env.ts (NFR-4).
        console.error("[pg-boss] error", error);
      });
      await boss.start();
      return boss;
    })();
  }
  return bossPromise;
}
