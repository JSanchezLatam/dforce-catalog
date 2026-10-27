/**
 * Real-SQL proof for the kanban-board urgent flag. The unit tests inject the
 * transaction, so they prove nothing about migration 0036, the CHECK, the
 * `ON DELETE SET NULL`, the UPDATE's columns or the absent `updatedAt` write.
 * Runs against a THROWAWAY database (`dforce_e2e`), never the dev one.
 */
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, users, vehiculo } from "@/shared/db/schema";
import type { Role } from "@/modules/auth/roles";
import { SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { transitionOrder } from "../modules/service-orders/service";
import { handleClear, handleSet } from "../app/api/service-orders/[id]/urgent/route";
import { purgeHistory } from "./purge-history";

describe("order urgent flag (E2E)", () => {
  const userIds: Record<"jefe" | "admin" | "tecnico" | "pantalla", string> = { jefe: "", admin: "", tecnico: "", pantalla: "" };
  let clienteId: string;
  let vehiculoId: string;

  const newOrder = async (status: "open" | "in_progress" = "open") => {
    const [row] = await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status }).returning({ id: ordenServicio.id });
    return row.id;
  };
  const rowOf = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];
  const call = (handler: typeof handleSet, id: string, who: keyof typeof userIds, role: Role) =>
    handler(
      new NextRequest(`http://localhost/api/service-orders/${id}/urgent`, { method: "POST", headers: { "x-user-id": userIds[who], "x-user-role": role } }),
      id,
    );
  const close = (id: string, to: "done" | "cancelled") =>
    transitionOrder(id, to, { scope: SYSTEM_SCOPE, canAssign: true, actorId: userIds.jefe, getClienteById: async () => null, cancelRemindersForOrder: async () => {} });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const stamp = Date.now();
    const make = async (key: keyof typeof userIds, role: Role) => {
      const [u] = await db.insert(users).values({ username: `e2e-urgent-${key}-${stamp}`, passwordHash: "x", role }).returning({ id: users.id });
      userIds[key] = u.id;
    };
    await make("jefe", "jefe_taller");
    await make("admin", "administrador");
    await make("tecnico", "tecnico");
    await make("pantalla", "pantalla");
    const [c] = await db.insert(cliente).values({ name: "E2E Urgent", phone: "50769993004" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "URG001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(inArray(users.id, Object.values(userIds).filter(Boolean)));
    await db.$client.end();
  });

  it("migration 0036 added both nullable columns and the SET NULL foreign key (the CHECK has its own test)", async () => {
    const cols = await db.execute(sql`select column_name, is_nullable from information_schema.columns
      where table_name = 'orden_servicio' and column_name in ('urgente_at', 'urgente_by') order by column_name`);
    expect(cols.rows).toEqual([
      { column_name: "urgente_at", is_nullable: "YES" },
      { column_name: "urgente_by", is_nullable: "YES" },
    ]);
    const fk = await db.execute(sql`select c.confdeltype as rule from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'orden_servicio'::regclass and c.contype = 'f' and a.attname = 'urgente_by'`);
    expect(fk.rows).toEqual([{ rule: "n" }]);
  });

  it("jefe sets then clears; the set writes the time and the jefe, the clear nulls both, and neither moves updatedAt", async () => {
    const id = await newOrder();
    const before = (await rowOf(id)).updatedAt;

    const set = await call(handleSet, id, "jefe", "jefe_taller");
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ urgent: true });
    const afterSet = await rowOf(id);
    expect(afterSet.urgenteAt).toBeInstanceOf(Date);
    expect(afterSet.urgenteBy).toBe(userIds.jefe);
    expect(afterSet.updatedAt).toEqual(before);

    const cleared = await call(handleClear, id, "jefe", "jefe_taller");
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ urgent: false });
    const afterClear = await rowOf(id);
    expect([afterClear.urgenteAt, afterClear.urgenteBy]).toEqual([null, null]);
    expect(afterClear.updatedAt).toEqual(before);
  });

  it("a técnico and a pantalla get 403 and both columns stay null", async () => {
    const id = await newOrder();
    expect((await call(handleSet, id, "tecnico", "tecnico")).status).toBe(403);
    expect((await call(handleSet, id, "pantalla", "pantalla")).status).toBe(403);
    const row = await rowOf(id);
    expect([row.urgenteAt, row.urgenteBy]).toEqual([null, null]);
  });

  it("an unknown order is 404", async () => {
    expect((await call(handleSet, "no-such-order", "jefe", "jefe_taller")).status).toBe(404);
  });

  it("setting an urgent order again succeeds and keeps the first setter and time", async () => {
    const id = await newOrder();
    await call(handleSet, id, "jefe", "jefe_taller");
    const first = await rowOf(id);

    const again = await call(handleSet, id, "admin", "administrador");

    expect(again.status).toBe(200);
    const row = await rowOf(id);
    expect(row.urgenteBy).toBe(userIds.jefe);
    expect(row.urgenteAt).toEqual(first.urgenteAt);
  });

  it("clearing a non-urgent order succeeds", async () => {
    const id = await newOrder();
    const res = await call(handleClear, id, "jefe", "jefe_taller");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urgent: false });
  });

  it.each(["done", "cancelled"] as const)("the flag survives the order reaching %s, and then it is closed: 409 both ways", async (to) => {
    const id = await newOrder("in_progress");
    await call(handleSet, id, "jefe", "jefe_taller");

    await close(id, to);

    const row = await rowOf(id);
    expect(row.status).toBe(to);
    expect(row.urgenteAt).toBeInstanceOf(Date);
    expect((await call(handleClear, id, "jefe", "jefe_taller")).status).toBe(409);
    expect((await call(handleSet, id, "jefe", "jefe_taller")).status).toBe(409);
    expect((await rowOf(id)).urgenteAt).toEqual(row.urgenteAt);
  });

  it("the database rejects urgente_by set while urgente_at is null", async () => {
    const id = await newOrder();
    await expect(db.update(ordenServicio).set({ urgenteBy: userIds.jefe }).where(eq(ordenServicio.id, id))).rejects.toThrow();
    expect((await rowOf(id)).urgenteBy).toBeNull();
  });

  it("deleting the user who set it nulls urgente_by and keeps the flag", async () => {
    const [setter] = await db.insert(users).values({ username: `e2e-urgent-setter-${Date.now()}`, passwordHash: "x", role: "jefe_taller" }).returning({ id: users.id });
    const id = await newOrder();
    await db.update(ordenServicio).set({ urgenteAt: new Date(), urgenteBy: setter.id }).where(eq(ordenServicio.id, id));

    await db.delete(users).where(eq(users.id, setter.id));

    const row = await rowOf(id);
    expect(row.urgenteBy).toBeNull();
    expect(row.urgenteAt).toBeInstanceOf(Date);
  });
});
