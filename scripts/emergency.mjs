// Emergency command for the workshop PC (login-hardening S13). It talks to the
// database directly, so it works only where DATABASE_URL reaches Postgres —
// the workshop PC — and needs no administrator session: it is the way back in
// when the only administrator is locked out. Run it from the checkout:
//
//   node scripts/emergency.mjs unlock <usuario>
//
// DATABASE_URL comes from the environment, or else from the checkout's `.env`
// (only Next.js loads `.env`; the operator should not have to set it by hand).
// shortcut: `unlockUser` repeats `unlockLogin` (src/modules/auth/login-attempts.ts)
// in plain SQL to avoid a TS runner, like seed-user.mjs; a change to the
// `unlocked` row or the advisory-lock key must be made in both places.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

/**
 * Writes the `unlocked` row that starts the user's lock count over; `false`
 * when no such user exists. `client` is ONE connection (a `pg.Client` or a
 * pool's checked-out client): the advisory lock lives in its transaction.
 */
export async function unlockUser(client, username) {
  const { rows } = await client.query("SELECT id, username FROM users WHERE username = $1", [username]);
  if (rows.length === 0) return false;
  const key = rows[0].username.slice(0, 150);

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`login-user:${key}`]);
    await client.query(
      "INSERT INTO login_attempts (id, at, username, user_id, ip, outcome) VALUES ($1, now(), $2, $3, NULL, 'unlocked')",
      [randomUUID(), key, rows[0].id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return true;
}

/** `DATABASE_URL` from the environment, else from `.env` beside `scripts/`. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, username] = process.argv.slice(2);
  if (command !== "unlock" || !username) {
    console.error("Uso: node scripts/emergency.mjs unlock <usuario>");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    if (await unlockUser(client, username)) {
      console.log(`Usuario "${username}" desbloqueado. Ya puede volver a entrar.`);
    } else {
      console.error(`No existe el usuario "${username}". Revisá mayúsculas y minúsculas.`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}
