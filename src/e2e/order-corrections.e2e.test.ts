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
import { cliente, ordenServicio, ordenServicioCorreccion, ordenServicioFoto, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { OrderClosedError } from "../modules/service-orders/order-lock";
import { addOrderPhoto, deleteOrderPhoto, MAX_PHOTOS, PhotoLimitError } from "../modules/service-orders/photos";
import { SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { updateOrder } from "../modules/service-orders/service";

const PASSWORD = "correct-horse-battery";
const COMPLETED_AT = new Date("2026-09-01T10:00:00.000Z");

describe("order corrections (E2E)", () => {
  const userIds: string[] = [];
  let adminId: string;
  let tecnicoId: string;
  let rosterId: string; // the técnico's roster row, so they can be ASSIGNED to an order
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

  const photoRows = (ordenId: string) =>
    db.select().from(ordenServicioFoto).where(eq(ordenServicioFoto.ordenId, ordenId)).orderBy(ordenServicioFoto.position);
  const seedPhotos = async (ordenId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await db.insert(ordenServicioFoto).values({ id: randomUUID(), ordenId, r2Key: `service-orders/${ordenId}/seed-${i}.jpg`, position: i });
    }
  };
  // R2 is the only fake: the lock, the cap, the audit insert and the rollback are the real ones.
  const r2 = (putFails = false) => ({
    putObject: async (key: string) => {
      if (putFails) throw new Error("r2 down");
      return key;
    },
    deleteObject: async () => {},
  });
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    adminId = await newUser("administrador", "admin");
    tecnicoId = await newUser("tecnico", "tecnico");
    [{ id: rosterId }] = await db.insert(tecnico).values({ nombre: "E2E Corr", userId: tecnicoId }).returning({ id: tecnico.id });
    const [c] = await db.insert(cliente).values({ name: "E2E Corr", phone: "50769993003" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "COR001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    for (const { id } of orders) await db.delete(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, id));
    for (const { id } of orders) await db.delete(ordenTecnico).where(eq(ordenTecnico.ordenId, id));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(eq(tecnico.id, rosterId));
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
    // Assigned: an UNASSIGNED técnico never gets this far, the scope answers 404 first (next case).
    await db.insert(ordenTecnico).values({ ordenId, tecnicoId: rosterId, assignedBy: adminId });

    const res = await patch(ordenId, { hallazgos: "cambiado", password: PASSWORD }, tecnicoId, "tecnico");

    expect(res.status).toBe(403);
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("an UNASSIGNED tecnico is 404 on a closed order, not the 403 that would confirm it exists", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    const res = await patch(ordenId, { hallazgos: "cambiado", password: PASSWORD }, tecnicoId, "tecnico");

    expect(res.status).toBe(404);
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
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
      updateOrder(ordenId, { hallazgos: "cambiado" }, { scope: SYSTEM_SCOPE, role: "administrador", correction: { correctorId: randomUUID() } }),
    ).rejects.toThrow();

    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
    expect(await auditRows(ordenId)).toEqual([]);
  });

  it("a closed order without a grant is refused by the real lock", async () => {
    const ordenId = await newOrder({ hallazgos: "intacto" });

    await expect(updateOrder(ordenId, { hallazgos: "cambiado" }, { scope: SYSTEM_SCOPE, role: "administrador" })).rejects.toBeInstanceOf(
      OrderClosedError,
    );
    expect((await orderRow(ordenId)).hallazgos).toBe("intacto");
  });

  describe("photos under correction", () => {
    it("an administrator adds to a done order with 2 photos: position 2 and exactly one foto audit row (null, photoId)", async () => {
      const ordenId = await newOrder();
      await seedPhotos(ordenId, 2);

      const photo = await addOrderPhoto(
        { scope: SYSTEM_SCOPE, ordenId, bytes: JPEG, createdBy: adminId, correction: { correctorId: adminId } },
        r2(),
      );

      expect(photo.position).toBe(2);
      expect(await photoRows(ordenId)).toHaveLength(3);
      const audit = await auditRows(ordenId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: adminId, field: "foto", oldValue: null, newValue: photo.id });
    });

    it("an administrator deletes from a cancelled order: the row is gone and exactly one foto audit row (photoId, null) is written", async () => {
      const ordenId = await newOrder({ status: "cancelled" });
      await seedPhotos(ordenId, 2);
      const [first] = await photoRows(ordenId);

      await deleteOrderPhoto({ scope: SYSTEM_SCOPE, ordenId, photoId: first.id, correction: { correctorId: adminId } }, r2());

      expect((await photoRows(ordenId)).map((p) => p.id)).not.toContain(first.id);
      expect(await photoRows(ordenId)).toHaveLength(1);
      const audit = await auditRows(ordenId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: adminId, field: "foto", oldValue: first.id, newValue: null });
    });

    it("12 photos refuse the 13th under correction, with no photo row and no audit row", async () => {
      const ordenId = await newOrder();
      await seedPhotos(ordenId, MAX_PHOTOS);

      await expect(
        addOrderPhoto({ scope: SYSTEM_SCOPE, ordenId, bytes: JPEG, correction: { correctorId: adminId } }, r2()),
      ).rejects.toBeInstanceOf(PhotoLimitError);

      expect(await photoRows(ordenId)).toHaveLength(MAX_PHOTOS);
      expect(await auditRows(ordenId)).toEqual([]);
    });

    it("a throwing put leaves 0 new photo rows and 0 audit rows", async () => {
      const ordenId = await newOrder();

      await expect(
        addOrderPhoto({ scope: SYSTEM_SCOPE, ordenId, bytes: JPEG, correction: { correctorId: adminId } }, r2(true)),
      ).rejects.toThrow("r2 down");

      expect(await photoRows(ordenId)).toEqual([]);
      expect(await auditRows(ordenId)).toEqual([]);
    });

    it("a closed order without a grant refuses both add and delete and writes nothing", async () => {
      const ordenId = await newOrder();
      await seedPhotos(ordenId, 1);
      const [only] = await photoRows(ordenId);

      await expect(addOrderPhoto({ scope: SYSTEM_SCOPE, ordenId, bytes: JPEG }, r2())).rejects.toBeInstanceOf(OrderClosedError);
      await expect(deleteOrderPhoto({ scope: SYSTEM_SCOPE, ordenId, photoId: only.id }, r2())).rejects.toBeInstanceOf(OrderClosedError);

      expect(await photoRows(ordenId)).toHaveLength(1);
      expect(await auditRows(ordenId)).toEqual([]);
    });
  });
});
