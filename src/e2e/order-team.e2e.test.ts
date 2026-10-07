/**
 * Real-SQL proof for technicians-and-work-lines WU7: the order detail's team
 * read is a join with a `WHERE` and an `ORDER BY`, so only Postgres proves it.
 * Run against a THROWAWAY database (`dforce_e2e`) — never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { listOrderAssignees } from "../modules/service-orders/order-team";

describe("order team reads (E2E)", () => {
  const stamp = Date.now();
  let adminId: string;
  let clienteId: string;
  let vehiculoId: string;
  let rosterA: string;
  let rosterOff: string;
  let rosterOther: string;

  const newOrder = async () =>
    (await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status: "in_progress" }).returning({ id: ordenServicio.id }))[0].id;

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    adminId = (await db.insert(users).values({ username: `e2e-team-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id }))[0].id;
    const roster = async (nombre: string, deactivatedAt?: Date) =>
      (await db.insert(tecnico).values({ nombre, deactivatedAt }).returning({ id: tecnico.id }))[0].id;
    rosterA = await roster("Team A");
    rosterOff = await roster("Team Off", new Date());
    rosterOther = await roster("Team Other");
    clienteId = (await db.insert(cliente).values({ name: "Team Cliente", phone: "50769994003" }).returning({ id: cliente.id }))[0].id;
    vehiculoId = (await db.insert(vehiculo).values({ clienteId, plate: "TEM001", motor: "combustion" }).returning({ id: vehiculo.id }))[0].id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [rosterA, rosterOff, rosterOther]));
    await db.delete(users).where(eq(users.id, adminId));
    await db.$client.end();
  });

  describe("listOrderAssignees", () => {
    it("returns this order's team in assignment order, with active and marked flags, and nobody else's", async () => {
      const ordenId = await newOrder();
      const otherId = await newOrder();
      await db.insert(ordenTecnico).values({ ordenId, tecnicoId: rosterOff, assignedBy: adminId, assignedAt: new Date("2026-01-01T10:00:00Z") });
      await db.insert(ordenTecnico).values({ ordenId, tecnicoId: rosterA, assignedBy: adminId, assignedAt: new Date("2026-01-02T10:00:00Z"), parteListaAt: new Date() });
      await db.insert(ordenTecnico).values({ ordenId: otherId, tecnicoId: rosterOther, assignedBy: adminId });

      expect(await listOrderAssignees(ordenId)).toEqual([
        { tecnicoId: rosterOff, nombre: "Team Off", active: false, parteLista: false },
        { tecnicoId: rosterA, nombre: "Team A", active: true, parteLista: true },
      ]);
    });

    it("returns an empty list for an order nobody is assigned to", async () => {
      expect(await listOrderAssignees(await newOrder())).toEqual([]);
    });
  });
});
