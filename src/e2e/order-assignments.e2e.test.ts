/**
 * Real-SQL proof for technicians-and-work-lines WU4b: the lock's scope and create
 * with technicians are `WHERE`s and a transaction, so only Postgres proves them.
 * Run against a THROWAWAY database (`dforce_e2e`) — never the dev one.
 */
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenServicioFoto, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { InvalidTecnicoError } from "../modules/service-orders/assignments";
import { lockOrderForMutation } from "../modules/service-orders/order-lock";
import { addOrderPhoto, deleteOrderPhoto } from "../modules/service-orders/photos";
import { orderScope, SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { createOrder, OrdenServicioNotFoundError } from "../modules/service-orders/service";

describe("order assignments and lock scope (E2E)", () => {
  const stamp = Date.now();
  const madeUsers: string[] = [];
  let admin: { id: string; role: Role };
  let tecA: { id: string; role: Role }; // roster row A
  let tecB: { id: string; role: Role }; // roster row B, never assigned to the seeded orders
  let rosterA: string;
  let rosterB: string;
  let rosterOff: string; // deactivated
  let clienteId: string;
  let vehiculoId: string;

  const insertUser = async (suffix: string, role: Role) => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-assign-${suffix}-${stamp}`, passwordHash: "x", role })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    return { id: u.id, role };
  };
  const newOrder = async (status: typeof ordenServicio.$inferInsert.status = "in_progress") =>
    (await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status }).returning({ id: ordenServicio.id }))[0].id;
  const assignDirect = (ordenId: string, tecnicoId: string, parteListaAt: Date | null = null) =>
    db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: admin.id, parteListaAt });
  const orderRow = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];
  const assignmentsOf = (ordenId: string) => db.select().from(ordenTecnico).where(eq(ordenTecnico.ordenId, ordenId));
  const request = (ordenId: string, user: { id: string; role: Role }, body: unknown) =>
    new NextRequest(`http://localhost/api/service-orders/${ordenId}`, {
      method: "PATCH",
      headers: { "x-user-id": user.id, "x-user-role": user.role, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const patch = (ordenId: string, user: { id: string; role: Role }, body: unknown) =>
    handleUpdateOrdenServicio(request(ordenId, user, body), ordenId);

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    admin = await insertUser("admin", "administrador");
    tecA = await insertUser("a", "tecnico");
    tecB = await insertUser("b", "tecnico");
    const insertRoster = async (nombre: string, userId?: string, deactivatedAt?: Date) =>
      (await db.insert(tecnico).values({ nombre, userId, deactivatedAt }).returning({ id: tecnico.id }))[0].id;
    rosterA = await insertRoster("Assign A", tecA.id);
    rosterB = await insertRoster("Assign B", tecB.id);
    rosterOff = await insertRoster("Assign Off", undefined, new Date());
    const [c] = await db.insert(cliente).values({ name: "Assign Cliente", phone: "50769994002" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "ASG001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) {
      await db.delete(ordenServicioFoto).where(inArray(ordenServicioFoto.ordenId, orders));
      await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    }
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [rosterA, rosterB, rosterOff]));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  describe("the lock's scope", () => {
    it("lock: an assigned técnico locks the order, an unassigned one finds no row, an administrador locks any", async () => {
      const ordenId = await newOrder();
      await assignDirect(ordenId, rosterA);
      const lock = (user: { id: string; role: Role }) =>
        db.transaction((tx) => lockOrderForMutation(tx, ordenId, { scope: orderScope(user), canWrite: () => true }));

      expect((await lock(tecA)).order.id).toBe(ordenId);
      await expect(lock(tecB)).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
      expect((await lock(admin)).order.id).toBe(ordenId);
    });

    it("PATCH fields: an unassigned técnico gets 404 and the row is unchanged", async () => {
      const ordenId = await newOrder();
      await assignDirect(ordenId, rosterA);

      const res = await patch(ordenId, tecB, { hallazgos: "no deberia" });

      expect(res.status).toBe(404);
      expect((await orderRow(ordenId)).hallazgos).toBeNull();
      expect((await patch(ordenId, tecA, { hallazgos: "si" })).status).toBe(200);
      expect((await orderRow(ordenId)).hallazgos).toBe("si");
    });

    it("transition: an unassigned técnico gets 404 and the status is unchanged; the assigned one starts work", async () => {
      const ordenId = await newOrder("open");
      await assignDirect(ordenId, rosterA);

      expect((await patch(ordenId, tecB, { status: "in_progress" })).status).toBe(404);
      expect((await orderRow(ordenId)).status).toBe("open");
      expect((await patch(ordenId, tecA, { status: "in_progress" })).status).toBe(200);
      expect((await orderRow(ordenId)).status).toBe("in_progress");
    });

    it("transition: the assigned técnico cannot close (403, unchanged); an administrador can", async () => {
      const ordenId = await newOrder("in_progress");
      await assignDirect(ordenId, rosterA);

      expect((await patch(ordenId, tecA, { status: "done" })).status).toBe(403);
      expect((await orderRow(ordenId)).status).toBe("in_progress");
      expect((await patch(ordenId, admin, { status: "done" })).status).toBe(200);
      expect((await orderRow(ordenId)).status).toBe("done");
    });

    it("photo add: an unassigned técnico is refused as not found and no row is written", async () => {
      const ordenId = await newOrder();
      await assignDirect(ordenId, rosterA);
      const deps = { putObject: async (key: string) => key, deleteObject: async () => {} };
      const input = { ordenId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };

      await expect(addOrderPhoto({ ...input, scope: orderScope(tecB) }, deps)).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
      expect(await db.select().from(ordenServicioFoto).where(eq(ordenServicioFoto.ordenId, ordenId))).toEqual([]);
      const { id } = await addOrderPhoto({ ...input, scope: orderScope(tecA) }, deps);
      expect(id).toBeTruthy();
    });

    it("photo delete: an unassigned técnico is refused as not found and the row stays", async () => {
      const ordenId = await newOrder();
      await assignDirect(ordenId, rosterA);
      const deps = { putObject: async (key: string) => key, deleteObject: async () => {} };
      const { id } = await addOrderPhoto({ ordenId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), scope: SYSTEM_SCOPE }, deps);

      await expect(deleteOrderPhoto({ ordenId, photoId: id, scope: orderScope(tecB) }, deps)).rejects.toBeInstanceOf(
        OrdenServicioNotFoundError,
      );
      expect(await db.select().from(ordenServicioFoto).where(eq(ordenServicioFoto.id, id))).toHaveLength(1);
    });
  });

  describe("create with technicians", () => {
    const base = () => ({ clienteId, vehiculoId, categoria: "revisado" as const, createdBy: admin.id });
    const orderCount = async () => (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).length;

    it("writes the order and its assignments together, open, with a null mark", async () => {
      const orden = await createOrder({ ...base(), tecnicoIds: [rosterA, rosterB, rosterA] });

      expect(orden.status).toBe("open");
      const rows = await assignmentsOf(orden.id);
      expect(rows.map((r) => r.tecnicoId).sort()).toEqual([rosterA, rosterB].sort());
      expect(rows.every((r) => r.parteListaAt === null && r.assignedBy === admin.id)).toBe(true);
    });

    it("creates an open order with no assignment when no technician is named", async () => {
      const orden = await createOrder(base());
      expect(orden.status).toBe("open");
      expect(await assignmentsOf(orden.id)).toEqual([]);
    });

    it("a deactivated technician refuses the whole create: no order, no assignment", async () => {
      const before = await orderCount();
      await expect(createOrder({ ...base(), tecnicoIds: [rosterA, rosterOff] })).rejects.toBeInstanceOf(InvalidTecnicoError);
      expect(await orderCount()).toBe(before);
    });

    it("an unknown technician id refuses the create too, rather than a 500 from the FK", async () => {
      const before = await orderCount();
      await expect(createOrder({ ...base(), tecnicoIds: ["no-such-tecnico"] })).rejects.toBeInstanceOf(InvalidTecnicoError);
      expect(await orderCount()).toBe(before);
    });
  });
});
