/**
 * Real-SQL proof for technicians-and-work-lines WU1 (migrations 0028/0029).
 *
 * The workshop applies 0026 through 0029 in ONE `migrate()` run, and the drizzle
 * migrator wraps every pending file in a single transaction. Postgres refuses to
 * USE an enum value in the transaction that added it, so the order that matters
 * is this one: a database sitting at 0025 with real `tecnico` users, then the
 * real migrations folder applied in one go. That cannot be reproduced through
 * the shared `dforce_e2e` (other suites migrate it first), so this file builds
 * its own throwaway databases next to it and drops them after.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.resolve(import.meta.dirname, "../shared/db/migrations");
const FROM_0025 = "dforce_e2e_techmig_0025";
const FROM_SCRATCH = "dforce_e2e_techmig_scratch";

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

async function recreate(admin: Client, database: string) {
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  await admin.query(`CREATE DATABASE ${database}`);
}

describe("migrations 0026-0029 in one run (E2E)", () => {
  let admin: Client;
  let upgraded: Client; // 0025 + seeded users, then 0026-0029 in ONE migrate()
  let fresh: Client; // empty database, everything in one migrate()
  const stages: string[] = [];

  beforeAll(async () => {
    admin = await connect("postgres");
    await recreate(admin, FROM_0025);
    await recreate(admin, FROM_SCRATCH);

    upgraded = await connect(FROM_0025);
    const to0025 = foldedUpTo(25);
    stages.push(to0025);
    await migrate(drizzle(upgraded), { migrationsFolder: to0025 });
    await upgraded.query(`
      INSERT INTO users (id, username, password_hash, role, name, deactivated_at) VALUES
        ('u-blank', 'blank-name', 'x', 'tecnico', '   ', NULL),
        ('u-named', 'named', 'x', 'tecnico', 'Ana Pérez', now()),
        ('u-admin', 'the-admin', 'x', 'administrador', 'Owner', NULL)`);
    // The real folder: 0026, 0027, 0028 and 0029 are all pending, so they share one transaction.
    await migrate(drizzle(upgraded), { migrationsFolder: MIGRATIONS });

    fresh = await connect(FROM_SCRATCH);
    await migrate(drizzle(fresh), { migrationsFolder: MIGRATIONS });
  }, 120_000);

  afterAll(async () => {
    await upgraded?.end();
    await fresh?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${FROM_0025}`);
    await admin?.query(`DROP DATABASE IF EXISTS ${FROM_SCRATCH}`);
    await admin?.end();
    for (const dir of stages) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("backfill", () => {
    it("gives each técnico user exactly one linked roster row, named from `name` or else `username`", async () => {
      const { rows } = await upgraded.query(`SELECT nombre, user_id FROM tecnico ORDER BY user_id`);
      expect(rows).toEqual([
        { nombre: "blank-name", user_id: "u-blank" },
        { nombre: "Ana Pérez", user_id: "u-named" },
      ]);
    });

    it("carries a deactivated login over as a deactivated roster row", async () => {
      const { rows } = await upgraded.query(`SELECT deactivated_at FROM tecnico WHERE user_id = 'u-named'`);
      expect(rows[0].deactivated_at).not.toBeNull();
      const active = await upgraded.query(`SELECT deactivated_at FROM tecnico WHERE user_id = 'u-blank'`);
      expect(active.rows[0].deactivated_at).toBeNull();
    });

    it("gives an administrador no roster row", async () => {
      const { rowCount } = await upgraded.query(`SELECT 1 FROM tecnico WHERE user_id = 'u-admin'`);
      expect(rowCount).toBe(0);
    });

    it("creates no assignment", async () => {
      const { rows } = await upgraded.query(`SELECT count(*)::int AS n FROM orden_tecnico`);
      expect(rows[0].n).toBe(0);
    });

    it("leaves a database migrated from scratch with an empty roster", async () => {
      const { rows } = await fresh.query(`SELECT count(*)::int AS n FROM tecnico`);
      expect(rows[0].n).toBe(0);
    });
  });

  describe("enum values (usable once the migrations commit)", () => {
    it("accepts jefe_taller and orders ready_for_review before done", async () => {
      await fresh.query(`INSERT INTO users (id, username, password_hash, role) VALUES ('u-jefe', 'jefe', 'x', 'jefe_taller')`);
      const { rows } = await fresh.query(
        `SELECT unnest(enum_range(NULL::order_status))::text AS v`,
      );
      expect(rows.map((r) => r.v)).toEqual(["open", "in_progress", "ready_for_review", "done", "cancelled"]);
    });
  });

  describe("constraints", () => {
    let ordenId: string;
    let assigned: string;
    let unassigned: string;

    beforeAll(async () => {
      await fresh.query(`INSERT INTO users (id, username, password_hash, role) VALUES ('u-c', 'constraints', 'x', 'administrador')`);
      await fresh.query(`INSERT INTO cliente (id, name, phone) VALUES ('c1', 'Cliente', '50760000001')`);
      await fresh.query(`INSERT INTO vehiculo (id, cliente_id, plate, motor) VALUES ('v1', 'c1', 'TEC001', 'combustion')`);
      await fresh.query(`INSERT INTO orden_servicio (id, cliente_id, vehiculo_id, categoria) VALUES ('o1', 'c1', 'v1', 'revisado')`);
      ordenId = "o1";
      assigned = "t-assigned";
      unassigned = "t-unassigned";
      await fresh.query(`INSERT INTO tecnico (id, nombre) VALUES ($1, 'Asignado'), ($2, 'Libre')`, [assigned, unassigned]);
      await fresh.query(`INSERT INTO orden_tecnico (orden_id, tecnico_id, assigned_by) VALUES ($1, $2, 'u-c')`, [ordenId, assigned]);
    });

    const line = (tecnicoId: string, minutes: number) =>
      fresh.query(
        `INSERT INTO orden_linea_trabajo (id, orden_id, tecnico_id, descripcion, duracion_minutos, fecha, created_by)
         VALUES (gen_random_uuid()::text, $1, $2, 'Cambio de aceite', $3, '2026-10-06', 'u-c')`,
        [ordenId, tecnicoId, minutes],
      );

    it("rejects a second roster row for one login", async () => {
      await fresh.query(`INSERT INTO tecnico (id, nombre, user_id) VALUES ('t-link-1', 'Uno', 'u-c')`);
      await expect(
        fresh.query(`INSERT INTO tecnico (id, nombre, user_id) VALUES ('t-link-2', 'Dos', 'u-c')`),
      ).rejects.toMatchObject({ code: "23505", constraint: "tecnico_user_id_unique" });
    });

    it("rejects deleting a technician who is assigned to an order", async () => {
      await expect(fresh.query(`DELETE FROM tecnico WHERE id = $1`, [assigned])).rejects.toMatchObject({
        code: "23503",
        constraint: "orden_tecnico_tecnico_id_tecnico_id_fk",
      });
    });

    it("rejects a work line naming a technician who is not assigned to that order", async () => {
      await expect(line(unassigned, 30)).rejects.toMatchObject({
        code: "23503",
        constraint: "orden_linea_trabajo_asignacion_fk",
      });
    });

    it("accepts a work line for the assigned technician", async () => {
      await expect(line(assigned, 30)).resolves.toBeDefined();
    });

    it("rejects deleting an assignment that has work lines", async () => {
      await expect(
        fresh.query(`DELETE FROM orden_tecnico WHERE orden_id = $1 AND tecnico_id = $2`, [ordenId, assigned]),
      ).rejects.toMatchObject({ code: "23503", constraint: "orden_linea_trabajo_asignacion_fk" });
    });

    it.each([0, -5, 1441])("rejects a duration of %i minutes", async (minutes) => {
      await expect(line(assigned, minutes)).rejects.toMatchObject({ code: "23514", constraint: "orden_linea_duracion_range" });
    });

    it("accepts the 1 and 1440 minute edges", async () => {
      await expect(line(assigned, 1)).resolves.toBeDefined();
      await expect(line(assigned, 1440)).resolves.toBeDefined();
    });
  });
});
