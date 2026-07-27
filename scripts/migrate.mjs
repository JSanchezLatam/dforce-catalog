import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const MIGRATIONS_FOLDER = new URL("../src/shared/db/migrations", import.meta.url).pathname;

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations applied successfully");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
