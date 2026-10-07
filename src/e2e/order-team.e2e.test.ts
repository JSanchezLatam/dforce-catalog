/**
 * Real-SQL proof for technicians-and-work-lines WU7: the order detail's team
 * read is a join with a `WHERE` and an `ORDER BY`, so only Postgres proves it.
 * Run against a THROWAWAY database (`dforce_e2e`) — never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenLineaTrabajo, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { listOrderAssignees, listOrderLines } from "../modules/service-orders/order-team";

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
    if (orders.length) await db.delete(ordenLineaTrabajo).where(inArray(ordenLineaTrabajo.ordenId, orders));
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

  describe("listOrderLines", () => {
    const line = (ordenId: string, tecnicoId: string, descripcion: string, fecha: string, duracionMinutos: number, createdAt?: Date) =>
      db.insert(ordenLineaTrabajo).values({ ordenId, tecnicoId, descripcion, fecha, duracionMinutos, createdBy: adminId, ...(createdAt && { createdAt }) });

    it("returns this order's lines oldest day first with the technician's name, and no other order's", async () => {
      const ordenId = await newOrder();
      const otherId = await newOrder();
      await db.insert(ordenTecnico).values([
        { ordenId, tecnicoId: rosterA, assignedBy: adminId },
        { ordenId, tecnicoId: rosterOff, assignedBy: adminId },
        { ordenId: otherId, tecnicoId: rosterOther, assignedBy: adminId },
      ]);
      // Inserted out of order on purpose: only the createdAt tiebreak puts "segunda" before "misma fecha".
      await line(ordenId, rosterA, "misma fecha, despues", "2026-02-02", 5, new Date("2026-02-02T11:00:00Z"));
      await line(ordenId, rosterOff, "primera", "2026-02-01", 90);
      await line(ordenId, rosterA, "segunda", "2026-02-02", 45, new Date("2026-02-02T10:00:00Z"));
      await line(otherId, rosterOther, "de otra orden", "2026-02-01", 10);

      const lines = await listOrderLines(ordenId);

      expect(lines.map((l) => l.descripcion)).toEqual(["primera", "segunda", "misma fecha, despues"]);
      expect(lines[0]).toMatchObject({ tecnicoId: rosterOff, tecnicoNombre: "Team Off", duracionMinutos: 90, fecha: "2026-02-01" });
      expect(typeof lines[0].id).toBe("string");
    });

    it("returns an empty list for an order with no lines", async () => {
      expect(await listOrderLines(await newOrder())).toEqual([]);
    });
  });
});
