import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

// `fileURLToPath`, not `.pathname`: a URL pathname stays percent-encoded, so
// any space in the checkout path arrives as "%20" and the folder is not found.
// Invisible inside Docker (the image copies to /app) and fatal on a host whose
// project directory has a space in it.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../src/shared/db/migrations", import.meta.url));

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
