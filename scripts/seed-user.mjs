// ponytail: talks to Postgres directly (pg + bcrypt, both already runtime
// deps) instead of importing the Drizzle schema/TS client — avoids adding a
// TS script runner (tsx/ts-node) just for one seed script. Ceiling: if the
// `users` table shape changes, this INSERT must be updated by hand too.
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import pg from "pg";

const [username, password, role = "usuario"] = process.argv.slice(2);

if (!username || !password) {
  console.error("Usage: node scripts/seed-user.mjs <username> <password> [usuario|administrador]");
  process.exit(1);
}

if (role !== "usuario" && role !== "administrador") {
  console.error(`Invalid role "${role}" — must be "usuario" or "administrador".`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), username, passwordHash, role],
  );
  console.log(`Created user "${username}" with role "${role}".`);
} finally {
  await client.end();
}
