/**
 * Real-SQL proof for service-order-workflow-states WU1 (migration 0033).
 *
 * 0033 adds three `order_status` values and, in the SAME file, a CHECK that reads
 * `status`. The drizzle migrator wraps every pending file in ONE transaction and
 * Postgres refuses to USE an enum value in the transaction that added it, so the
 * CHECK compares `status::text`. Only a database that already holds orders at
 * 0032 and then applies the real folder in one `migrate()` proves that, so this
 * file builds its own throwaway databases (same shape as
 * `technicians-migration.e2e.test.ts`) and drops them after.
 * 0034's assertions arrive with WU3.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.resolve(import.meta.dirname, "../shared/db/migrations");
const FROM_0032 = "dforce_e2e_statusmig_0032";

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${database}`;
  return url.toString();
}

/** A copy of the real folder holding only the migrations up to and including `lastIdx`. */
function foldedUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

async function connect(database: string): Promise<Client> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  return client;
}

describe("migration 0033 on a database that already holds orders (E2E)", () => {
  let admin: Client;
  let db: Client;
  let stage: string;

  beforeAll(async () => {
    admin = await connect("postgres");
    await admin.query(`DROP DATABASE IF EXISTS ${FROM_0032}`);
    await admin.query(`CREATE DATABASE ${FROM_0032}`);

    db = await connect(FROM_0032);
    stage = foldedUpTo(32);
    await migrate(drizzle(db), { migrationsFolder: stage });
    await db.query(`
      INSERT INTO cliente (id, name, phone) VALUES ('c1', 'Cliente', '50760000001');
      INSERT INTO vehiculo (id, cliente_id, plate, motor) VALUES ('v1', 'c1', 'MIG001', 'combustion');
      INSERT INTO orden_servicio (id, cliente_id, vehiculo_id, categoria, status) VALUES
        ('o-progress', 'c1', 'v1', 'revisado', 'in_progress'),
        ('o-done', 'c1', 'v1', 'revisado', 'done')`);
    // The real folder: 0033 is pending (and WU3's 0034 will be, in the same transaction).
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${FROM_0032}`);
    await admin?.end();
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
  });

  it("orders the enum booked, open, diagnosing, in_progress, on_hold, ready_for_review, done, cancelled", async () => {
    const { rows } = await db.query(`SELECT unnest(enum_range(NULL::order_status))::text AS v`);
    expect(rows.map((r) => r.v)).toEqual([
      "booked",
      "open",
      "diagnosing",
      "in_progress",
      "on_hold",
      "ready_for_review",
      "done",
      "cancelled",
    ]);
  });

  it("keeps the existing orders' statuses and gives them no hold reason", async () => {
    const { rows } = await db.query(`SELECT id, status::text AS status, espera_motivo FROM orden_servicio ORDER BY id`);
    expect(rows).toEqual([
      { id: "o-done", status: "done", espera_motivo: null },
      { id: "o-progress", status: "in_progress", espera_motivo: null },
    ]);
  });

  it("writes nothing to the status history", async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM orden_estado_historial`);
    expect(rows[0].n).toBe(0);
  });

  describe("orden_espera_motivo_on_hold", () => {
    const setStatus = (id: string, status: string, motivo: string | null) =>
      db.query(`UPDATE orden_servicio SET status = $2::order_status, espera_motivo = $3::espera_motivo WHERE id = $1`, [id, status, motivo]);

    it("rejects on_hold without a reason", async () => {
      await expect(setStatus("o-progress", "on_hold", null)).rejects.toMatchObject({
        code: "23514",
        constraint: "orden_espera_motivo_on_hold",
      });
    });

    it("rejects a reason on an order that is not on hold", async () => {
      await expect(setStatus("o-progress", "in_progress", "repuesto")).rejects.toMatchObject({
        code: "23514",
        constraint: "orden_espera_motivo_on_hold",
      });
    });

    it("accepts on_hold with a reason, and leaving it with the reason cleared", async () => {
      await expect(setStatus("o-progress", "on_hold", "aprobacion_cliente")).resolves.toBeDefined();
      await expect(setStatus("o-progress", "in_progress", null)).resolves.toBeDefined();
    });
  });

  describe("orden_estado_historial", () => {
    it("rejects deleting an order that has history, and keeps the row when its actor goes", async () => {
      await db.query(`INSERT INTO users (id, username, password_hash, role) VALUES ('u-h', 'historian', 'x', 'administrador')`);
      await db.query(
        `INSERT INTO orden_estado_historial (id, orden_id, from_status, to_status, changed_by) VALUES ('h1', 'o-done', NULL, 'booked', 'u-h')`,
      );
      await expect(db.query(`DELETE FROM orden_servicio WHERE id = 'o-done'`)).rejects.toMatchObject({ code: "23503" });

      await db.query(`DELETE FROM users WHERE id = 'u-h'`);
      const { rows } = await db.query(`SELECT changed_by FROM orden_estado_historial WHERE id = 'h1'`);
      expect(rows).toEqual([{ changed_by: null }]);
    });

    it("stamps two rows of one transaction with different times (clock_timestamp, not now)", async () => {
      await db.query("BEGIN");
      try {
        await db.query(`INSERT INTO orden_estado_historial (id, orden_id, to_status) VALUES ('h2', 'o-progress', 'open')`);
        await db.query(`SELECT pg_sleep(0.01)`);
        await db.query(`INSERT INTO orden_estado_historial (id, orden_id, from_status, to_status) VALUES ('h3', 'o-progress', 'open', 'diagnosing')`);
        const { rows } = await db.query(`SELECT (SELECT changed_at FROM orden_estado_historial WHERE id = 'h3') > (SELECT changed_at FROM orden_estado_historial WHERE id = 'h2') AS later`);
        expect(rows[0].later).toBe(true);
      } finally {
        await db.query("ROLLBACK");
      }
    });
  });
});
