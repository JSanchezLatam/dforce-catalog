// Emergency command for the workshop PC (login-hardening S13). It talks to the
// database directly, so it works only where DATABASE_URL reaches Postgres —
// the workshop PC — and needs no administrator session: it is the way back in
// when the only administrator is locked out. Run it from the checkout:
//
//   node scripts/emergency.mjs unlock <usuario>
//   node scripts/emergency.mjs reset-2fa <usuario>
//
// DATABASE_URL comes from the environment, or else from the checkout's `.env`
// (only Next.js loads `.env`; the operator should not have to set it by hand).
// shortcut: `unlockUser` repeats `unlockLogin` (src/modules/auth/login-attempts.ts)
// in plain SQL to avoid a TS runner, like seed-user.mjs; a change to the
// `unlocked` row or the advisory-lock key (`takeLoginLocks`) must be made in both places. Likewise
// `resetTwoFactorByUsername` repeats `resetTwoFactor` (src/modules/auth/two-factor-reset.ts)
// and `MANDATORY_ROLES` repeats `requiresTwoFactor` (src/modules/auth/enrolment.ts).
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
    // A failed ROLLBACK (a dropped connection) must not hide why the unlock failed.
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
  return true;
}

/** S2's mandatory roles: they enrol again at their next login. */
const MANDATORY_ROLES = ["administrador", "jefe_taller"];

/**
 * Deletes the user's app secret, recovery codes and trusted devices and
 * revokes every session, in one transaction (S13, A5). Returns the user's
 * role, or `null` when no such user exists. `client` is ONE connection.
 */
export async function resetTwoFactorByUsername(client, username) {
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id, username, role FROM users WHERE username = $1", [username]);
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const { id, role } = rows[0];
    // The login lock a second-step code check holds, so the two cannot interleave.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`login-user:${rows[0].username.slice(0, 150)}`]);
    await client.query("DELETE FROM recovery_codes WHERE user_id = $1", [id]);
    await client.query("DELETE FROM user_totp WHERE user_id = $1", [id]);
    await client.query("DELETE FROM trusted_devices WHERE user_id = $1", [id]);
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    await client.query("COMMIT");
    return role;
  } catch (error) {
    // A failed ROLLBACK (a dropped connection) must not hide why the reset failed.
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
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
  if (!["unlock", "reset-2fa"].includes(command) || !username) {
    console.error("Uso:\n  node scripts/emergency.mjs unlock <usuario>\n  node scripts/emergency.mjs reset-2fa <usuario>");
    process.exit(1);
  }
  const connectionString = databaseUrl();
  if (!connectionString) {
    // Without it, pg falls back to libpq defaults and could reach another database.
    console.error("Falta DATABASE_URL: corré el comando desde la carpeta del proyecto, donde está el .env.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (command === "unlock") {
      if (await unlockUser(client, username)) {
        console.log(`Usuario "${username}" desbloqueado. Ya puede volver a entrar.`);
      } else {
        console.error(`No existe el usuario "${username}". Revisá mayúsculas y minúsculas.`);
        process.exitCode = 1;
      }
    } else {
      const role = await resetTwoFactorByUsername(client, username);
      if (role === null) {
        console.error(`No existe el usuario "${username}". Revisá mayúsculas y minúsculas.`);
        process.exitCode = 1;
      } else {
        const next = MANDATORY_ROLES.includes(role)
          ? "La próxima vez que entre la va a tener que configurar de nuevo."
          : "Va a poder activarla de nuevo desde Mi cuenta.";
        console.log(`2FA de "${username}" reseteada. ${next}`);
      }
    }
  } finally {
    await client.end();
  }
}
