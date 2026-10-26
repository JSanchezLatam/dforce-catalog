/**
 * Real-SQL proof for service-order-workflow-states WU3: an Agendada (`booked`) order may lack its
 * vehicle and category (migration 0034), and everything that reads or moves such an order has to
 * cope. The unit suites inject the database, so neither the LEFT JOIN, the count/list parity, the
 * CHECK behind the receive refusal nor the vehicle lookup is exercised there.
 * Run against a THROWAWAY database (`dforce_e2e`), never the dev one.
 */
import { execSync } from "node:child_process";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { assignTecnico } from "../modules/service-orders/assignments";
import { countOrdenesServicio, listOrdenesServicio } from "../modules/service-orders/queries";
import { SYSTEM_SCOPE } from "../modules/service-orders/scope";
import {
  AppointmentRequiredError,
  createOrder,
  InvalidCategoriaError,
  InvalidVehiculoError,
  OrderIncompleteError,
  transitionOrder,
  updateOrder,
} from "../modules/service-orders/service";
import { purgeHistory } from "./purge-history";

type Status = typeof ordenServicio.$inferInsert.status;

describe("booked orders without a vehicle or category (E2E)", () => {
  const stamp = Date.now();
  const APPOINTMENT = new Date("2026-12-01T15:00:00Z");
  const page = { offset: 0, limit: 50 };
  const clienteIds: string[] = [];
  let admin: string;
  let rosterId: string;
  let listCliente: string; // only the list/count tests touch it, so their totals are exact
  let ownerId: string;
  let ownerVehicle: string;
  let ownerInactiveVehicle: string;
  let foreignVehicle: string;

  const newCliente = async (name: string, phone: string) => {
    const [c] = await db.insert(cliente).values({ name, phone }).returning({ id: cliente.id });
    clienteIds.push(c.id);
    return c.id;
  };
  /** A direct insert, so a status can be seeded that no code path reaches in one step. */
  const seed = async (status: Status, extra: Partial<typeof ordenServicio.$inferInsert> = {}, clienteId = ownerId) =>
    (
      await db
        .insert(ordenServicio)
        .values({ clienteId, vehiculoId: ownerVehicle, categoria: "revisado", status, ...extra })
        .returning({ id: ordenServicio.id })
    )[0].id;
  const noVehicle = { vehiculoId: null, categoria: null } as const;
  const rowOf = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];
  const trail = async (ordenId: string) =>
    (await db.select().from(ordenEstadoHistorial).where(eq(ordenEstadoHistorial.ordenId, ordenId)).orderBy(asc(ordenEstadoHistorial.changedAt))).map(
      (r) => [r.fromStatus, r.toStatus] as const,
    );
  const countFor = async (clienteId: string) => (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).length;

  const create = (extra: Partial<Parameters<typeof createOrder>[0]> = {}) =>
    createOrder(
      { clienteId: ownerId, createdBy: admin, ...extra },
      { enqueuePortalSync: async () => {}, planReminders: () => [] },
    );
  const edit = (id: string, patch: Parameters<typeof updateOrder>[1]) =>
    updateOrder(id, patch, { scope: SYSTEM_SCOPE, role: "administrador", enqueuePortalSync: async () => {} });
  const move = (id: string, to: Parameters<typeof transitionOrder>[1]) =>
    transitionOrder(id, to, {
      scope: SYSTEM_SCOPE,
      canAssign: true,
      actorId: admin,
      getClienteById: async () => null,
      cancelRemindersForOrder: async () => {},
      enqueuePortalSync: async () => {},
    });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [a] = await db.insert(users).values({ username: `e2e-bk-admin-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    admin = a.id;
    const [t] = await db.insert(tecnico).values({ nombre: `Bk ${stamp}` }).returning({ id: tecnico.id });
    rosterId = t.id;

    listCliente = await newCliente(`Pérez Lst${stamp}`, "50769994101");
    ownerId = await newCliente(`Owner Bk${stamp}`, "50769994102");
    const otherId = await newCliente(`Other Bk${stamp}`, "50769994103");
    const [lv] = await db.insert(vehiculo).values({ clienteId: listCliente, plate: `PLT`, motor: "combustion" }).returning({ id: vehiculo.id });
    const [ov, oi] = await db
      .insert(vehiculo)
      .values([
        { clienteId: ownerId, plate: `OWN${stamp}`, motor: "combustion" },
        { clienteId: ownerId, plate: `OFF${stamp}`, motor: "combustion", deactivatedAt: new Date() },
      ])
      .returning({ id: vehiculo.id });
    const [fv] = await db.insert(vehiculo).values({ clienteId: otherId, plate: `FOR${stamp}`, motor: "combustion" }).returning({ id: vehiculo.id });
    ownerVehicle = ov.id;
    ownerInactiveVehicle = oi.id;
    foreignVehicle = fv.id;

    // Five orders for the list customer, one per status the list has to place; two have no vehicle.
    await seed("booked", noVehicle, listCliente);
    await seed("open", { vehiculoId: lv.id }, listCliente);
    await seed("diagnosing", { vehiculoId: lv.id }, listCliente);
    await seed("on_hold", { vehiculoId: lv.id, esperaMotivo: "repuesto" }, listCliente);
    await seed("cancelled", noVehicle, listCliente);
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(inArray(ordenServicio.clienteId, clienteIds))).map((o) => o.id);
    if (orders.length) await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await purgeHistory(clienteIds);
    await db.delete(ordenServicio).where(inArray(ordenServicio.clienteId, clienteIds));
    await db.delete(vehiculo).where(inArray(vehiculo.clienteId, clienteIds));
    await db.delete(cliente).where(inArray(cliente.id, clienteIds));
    await db.delete(tecnico).where(eq(tecnico.id, rosterId));
    await db.delete(users).where(eq(users.id, admin));
    await db.$client.end();
  });

  describe("the list and its count", () => {
    const token = () => `perez lst${stamp}`;

    it("List and count agree: all five orders, vehicle-less ones included, then the Agendada alone", async () => {
      const all = { search: token() };
      expect(await listOrdenesServicio(all, page, SYSTEM_SCOPE)).toHaveLength(5);
      expect(await countOrdenesServicio(all, SYSTEM_SCOPE)).toBe(5);

      const booked = { search: token(), status: "booked" as const };
      const rows = await listOrdenesServicio(booked, page, SYSTEM_SCOPE);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "booked", vehiculoPlate: null, vehiculoMake: null, vehiculoModel: null });
      expect(await countOrdenesServicio(booked, SYSTEM_SCOPE)).toBe(1);
    });

    it.each(["diagnosing", "on_hold", "booked", "cancelled"] as const)("filters by %s: one row, count 1", async (status) => {
      const filters = { search: token(), status };
      const rows = await listOrdenesServicio(filters, page, SYSTEM_SCOPE);
      expect(rows.map((r) => r.status)).toEqual([status]);
      expect(await countOrdenesServicio(filters, SYSTEM_SCOPE)).toBe(1);
    });

    it("sorts Estado in lifecycle order, not alphabetically", async () => {
      const asc = await listOrdenesServicio({ search: token() }, page, SYSTEM_SCOPE, { key: "status", dir: "asc" });
      expect(asc.map((r) => r.status)).toEqual(["booked", "open", "diagnosing", "on_hold", "cancelled"]);
      const desc = await listOrdenesServicio({ search: token() }, page, SYSTEM_SCOPE, { key: "status", dir: "desc" });
      expect(desc.map((r) => r.status)).toEqual(["cancelled", "on_hold", "diagnosing", "open", "booked"]);
    });

    it("finds a vehicle-less order by customer name without accents, and a plate search does not error", async () => {
      const byName = await listOrdenesServicio({ search: `perez lst${stamp}`, status: "booked" }, page, SYSTEM_SCOPE);
      expect(byName).toHaveLength(1);

      const byPlate = { search: `PLT` };
      const rows = await listOrdenesServicio(byPlate, page, SYSTEM_SCOPE);
      expect(rows.map((r) => r.status).sort()).toEqual(["diagnosing", "on_hold", "open"]);
      expect(await countOrdenesServicio(byPlate, SYSTEM_SCOPE)).toBe(3);
    });
  });

  describe("creation", () => {
    it("an Agendada order is created with no vehicle or category and one null -> booked row", async () => {
      const orden = await create({ status: "booked", appointmentAt: APPOINTMENT });

      expect(await rowOf(orden.id)).toMatchObject({ status: "booked", vehiculoId: null, categoria: null, appointmentAt: APPOINTMENT });
      expect(await trail(orden.id)).toEqual([[null, "booked"]]);
    });

    it("an Agendada order with a technician stays booked: one assignment, no diagnosing row", async () => {
      const orden = await create({ status: "booked", appointmentAt: APPOINTMENT, tecnicoIds: [rosterId] });

      expect((await rowOf(orden.id)).status).toBe("booked");
      expect(await trail(orden.id)).toEqual([[null, "booked"]]);
      expect(await db.select().from(ordenTecnico).where(eq(ordenTecnico.ordenId, orden.id))).toHaveLength(1);
    });

    it("refuses an Agendada order without a date, and a Recibida one without vehicle or category, creating nothing", async () => {
      const before = await countFor(ownerId);

      await expect(create({ status: "booked" })).rejects.toBeInstanceOf(AppointmentRequiredError);
      await expect(create({ categoria: "revisado" })).rejects.toBeInstanceOf(InvalidVehiculoError);
      await expect(create({ vehiculoId: ownerVehicle })).rejects.toBeInstanceOf(InvalidCategoriaError);

      expect(await countFor(ownerId)).toBe(before);
    });
  });

  describe("setting the vehicle while booked", () => {
    it("completes a booked order: vehicle and category persist, the status stays booked", async () => {
      const id = await seed("booked", noVehicle);

      await edit(id, { vehiculoId: ownerVehicle, categoria: "reparacion" });

      expect(await rowOf(id)).toMatchObject({ status: "booked", vehiculoId: ownerVehicle, categoria: "reparacion" });
    });

    it("refuses another customer's vehicle and a deactivated one, leaving the order untouched", async () => {
      const id = await seed("booked", noVehicle);

      await expect(edit(id, { vehiculoId: foreignVehicle })).rejects.toBeInstanceOf(InvalidVehiculoError);
      await expect(edit(id, { vehiculoId: ownerInactiveVehicle })).rejects.toBeInstanceOf(InvalidVehiculoError);

      expect(await rowOf(id)).toMatchObject({ vehiculoId: null, categoria: null });
    });

    it("Vehicle frozen after booked: an open order keeps its stored vehicle when a patch names another", async () => {
      const [other] = await db.insert(vehiculo).values({ clienteId: ownerId, plate: `TWO${stamp}`, motor: "combustion" }).returning({ id: vehiculo.id });
      const id = await seed("open");

      await expect(edit(id, { vehiculoId: other.id })).rejects.toBeInstanceOf(InvalidVehiculoError);

      expect((await rowOf(id)).vehiculoId).toBe(ownerVehicle);
    });

    it("refuses clearing the date of a booked order, and still lets an open one lose its date", async () => {
      const booked = await seed("booked", { ...noVehicle, appointmentAt: APPOINTMENT });
      await expect(edit(booked, { appointmentAt: null })).rejects.toBeInstanceOf(AppointmentRequiredError);
      expect((await rowOf(booked)).appointmentAt).toEqual(APPOINTMENT);

      const open = await seed("open", { appointmentAt: APPOINTMENT });
      await edit(open, { appointmentAt: null });
      expect((await rowOf(open)).appointmentAt).toBeNull();
    });
  });

  describe("receiving, cancelling and assigning", () => {
    it("receiving a complete booked order opens it and stamps the move", async () => {
      const id = await seed("booked", {}, ownerId);
      const before = (await rowOf(id)).updatedAt;

      await move(id, "open");

      const row = await rowOf(id);
      expect(row.status).toBe("open");
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(await trail(id)).toEqual([["booked", "open"]]);
    });

    it("receiving without a vehicle is a Spanish refusal, never a CHECK 500, and the order stays booked", async () => {
      const id = await seed("booked", noVehicle);

      const refused = move(id, "open");

      await expect(refused).rejects.toBeInstanceOf(OrderIncompleteError);
      await expect(refused).rejects.toMatchObject({ message: expect.stringContaining("vehículo") });
      expect((await rowOf(id)).status).toBe("booked");
      expect(await trail(id)).toEqual([]);
    });

    it("receiving an order that already has a technician continues to diagnosing, with both rows", async () => {
      const id = await seed("booked");
      await db.insert(ordenTecnico).values({ ordenId: id, tecnicoId: rosterId, assignedBy: admin });

      await move(id, "open");

      expect((await rowOf(id)).status).toBe("diagnosing");
      expect(await trail(id)).toEqual([
        ["booked", "open"],
        ["open", "diagnosing"],
      ]);
    });

    it("cancels a no-show that never got a vehicle or category: the CHECK allows the nulls to stay", async () => {
      const id = await seed("booked", noVehicle);

      await move(id, "cancelled");

      expect(await rowOf(id)).toMatchObject({ status: "cancelled", vehiculoId: null, categoria: null });
      expect(await trail(id)).toEqual([["booked", "cancelled"]]);
    });

    it("assigning a technician to a booked order keeps it booked and writes no history row", async () => {
      const id = await seed("booked");

      await expect(assignTecnico({ ordenId: id, tecnicoId: rosterId, assignedBy: admin, scope: SYSTEM_SCOPE }, { enqueuePortalSync: async () => {} })).resolves.toEqual({
        created: true,
      });

      expect((await rowOf(id)).status).toBe("booked");
      expect(await trail(id)).toEqual([]);
    });
  });
});
