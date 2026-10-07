/**
 * Real-SQL proof for closed-order-lock WU2. The unit tests inject the
 * transaction and the users lookup, so they prove nothing about Postgres: not
 * the `FOR UPDATE`, not the audit insert's FK, not `findUserById`'s SELECT, not
 * the rollback. They do here, through the real PATCH handler and a real bcrypt
 * hash, against a THROWAWAY database (`dforce_e2e`, see README "Running the E2E
 * test") — never the dev one.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/modules/auth/password";
import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenServicioCorreccion, users, vehiculo } from "@/shared/db/schema";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { OrderClosedError } from "../modules/service-orders/order-lock";
import { updateOrder } from "../modules/service-orders/service";

const PASSWORD = "correct-horse-battery";
const COMPLETED_AT = new Date("2026-09-01T10:00:00.000Z");

describe("order corrections (E2E)", () => {
  const userIds: string[] = [];
  let adminId: string;
  let tecnicoId: string;
  let clienteId: string;
  let vehiculoId: string;

  const newUser = async (role: Role, label: string) => {
    const [row] = await db
      .insert(users)
      .values({ username: `e2e-corr-${label}-${Date.now()}`, passwordHash: await hashPassword(PASSWORD), role })
      .returning({ id: users.id });
    userIds.push(row.id);
    return row.id;
  };
  const newOrder = async (over: Partial<typeof ordenServicio.$inferInsert> = {}) => {
    const [row] = await db
      .insert(ordenServicio)
      .values({ clienteId, vehiculoId, categoria: "revisado", status: "done", completedAt: COMPLETED_AT, ...over })
      .returning({ id: ordenServicio.id });
    return row.id;
  };
  const patch = (ordenId: string, body: Record<string, unknown>, userId: string, role: Role) =>
    handleUpdateOrdenServicio(
      new NextRequest(`http://localhost/api/service-orders/${ordenId}`, {
        method: "PATCH",
        headers: { "x-user-id": userId, "x-user-role": role, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      ordenId,
    );
  const orderRow = async (ordenId: string) =>
    (await db.select().from(ordenServicio).where(eq(ordenServicio.id, ordenId)))[0];
  const auditRows = (ordenId: string) =>
    db.select().from(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, ordenId));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    adminId = await newUser("administrador", "admin");
    tecnicoId = await newUser("tecnico", "tecnico");
    const [c] = await db.insert(cliente).values({ name: "E2E Corr", phone: "50769993003" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "COR001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    for (const { id } of orders) await db.delete(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, id));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.$client.end();
  });

  it("an administrator's correction writes the field and exactly one audit row; status and completedAt are untouched", async () => {
    const ordenId = await newOrder();

    const res = await patch(ordenId, { hallazgos: "nuevo", password: PASSWORD }, adminId, "administrador");

    expect(res.status).toBe(200);
    const row = await orderRow(ordenId);
    expect(row).toMatchObject({ hallazgos: "nuevo", status: "done" });
    expect(row.completedAt).toEqual(COMPLETED_AT);
    expect(await auditRows(ordenId)).toMatchObject([
      { ordenId, userId: adminId, field: "hallazgos", oldValue: null, newValue: "nuevo" },
    ]);
  });

  it("two changed fields write exactly two rows", async () => {
    const ordenId = await newOrder({ hallazgos: "viejo" });

    const res = await patch(ordenId, { hallazgos: "nuevo", kilometraje: 1200, password: PASSWORD }, adminId, "administrador");

    expect(res.status).toBe(200);
    const rows = (await auditRows(ordenId)).map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue }));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { field: "hallazgos", oldValue: "viejo", newValue: "nuevo" },
        { field: "kilometraje", oldValue: null, newValue: "1200" },
      ]),
    );
  });

  it("a save that changes nothing writes zero audit rows", async () => {
    const ordenId = await newOrder({ hallazgos: "igual" });

    const res = await patch(ordenId, { hallazgos: "igual", password: PASSWORD }, adminId, "administrador");

    expect(res.status).toBe(200);
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a wrong password through the real handler is 403 and leaves the order and the audit table untouched", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });
    // Own admin: the failure counts toward THAT user's throttle, not the others'.
    const strangerId = await newUser("administrador", "wrong");

    const res = await patch(ordenId, { hallazgos: "cambiado", password: "mal" }, strangerId, "administrador");

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "wrong_password" });
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a tecnico with their own correct password is 403 and changes nothing", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    const res = await patch(ordenId, { hallazgos: "cambiado", password: PASSWORD }, tecnicoId, "tecnico");

    expect(res.status).toBe(403);
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("an administrator with no password on a closed order is 409 and changes nothing", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    const res = await patch(ordenId, { hallazgos: "cambiado" }, adminId, "administrador");

    expect(res.status).toBe(409);
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a password sent for an OPEN order is ignored: the edit lands with no audit row", async () => {
    const ordenId = await newOrder({ status: "open", completedAt: null });

    const res = await patch(ordenId, { hallazgos: "abierta", password: PASSWORD }, adminId, "administrador");

    expect(res.status).toBe(200);
    expect((await orderRow(ordenId)).hallazgos).toBe("abierta");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a correctorId that is not a user fails the audit insert's FK and rolls the UPDATE back", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    await expect(
      updateOrder(ordenId, { hallazgos: "cambiado" }, { role: "administrador", correction: { correctorId: randomUUID() } }),
    ).rejects.toThrow();

    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a closed order without a grant is refused by the real lock", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    await expect(updateOrder(ordenId, { hallazgos: "cambiado" }, { role: "administrador" })).rejects.toBeInstanceOf(
      OrderClosedError,
    );
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
  });
});
