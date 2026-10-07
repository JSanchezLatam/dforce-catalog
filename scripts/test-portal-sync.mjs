// `npm run test:portal-sync`: the workshop sync job against the portal's real
// handlers, on two THROWAWAY databases created here and dropped at the end.
// The names are fixed and are never `dforce_catalog` / `dforce_portal`.
// Admin URL: PORTAL_SYNC_ADMIN_URL (default: the docker Postgres on :5433).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const ADMIN_URL = process.env.PORTAL_SYNC_ADMIN_URL ?? "postgres://dforce:dforce@localhost:5433/postgres";
const WORKSHOP_DB = "dforce_portalsync_workshop";
const PORTAL_DB = "dforce_portalsync_portal";
const urlFor = (name) => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.href;
};
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const admin = new pg.Client({ connectionString: ADMIN_URL });
try {
  await admin.connect();
} catch (error) {
  console.error(`test:portal-sync: Postgres is not reachable at ${ADMIN_URL.replace(/:[^:@/]*@/, ":***@")}\n${error.message}`);
  process.exit(1);
}

const drop = async () => {
  for (const name of [WORKSHOP_DB, PORTAL_DB]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
};

let status = 1;
try {
  await drop();
  for (const name of [WORKSHOP_DB, PORTAL_DB]) await admin.query(`CREATE DATABASE ${name}`);

  const workshopUrl = urlFor(WORKSHOP_DB);
  const portalUrl = urlFor(PORTAL_DB);

  const migrated = spawnSync("node", [here("./migrate.mjs")], { stdio: "inherit", env: { ...process.env, DATABASE_URL: workshopUrl } });
  if (migrated.status !== 0) throw new Error("workshop migrations failed");
  const pool = new pg.Pool({ connectionString: portalUrl });
  await migrate(drizzle(pool), { migrationsFolder: here("../portal/src/db/migrations") });
  await pool.end();

  const run = spawnSync("npx", ["vitest", "run", "-c", "vitest.portal-sync.config.ts"], {
    stdio: "inherit",
    env: { ...process.env, PORTAL_SYNC_WORKSHOP_URL: workshopUrl, PORTAL_SYNC_PORTAL_URL: portalUrl },
  });
  status = run.status ?? 1;
} catch (error) {
  console.error(error);
} finally {
  await drop().catch((e) => console.error("could not drop the throwaway databases:", e.message));
  await admin.end();
}
process.exit(status);
