/**
 * Real-SQL proof for workshop-agenda WU5: the in-workshop read, the Vencidas total and the board privacy
 * line. Unit tests cannot see a WHERE or a join. Run against the THROWAWAY `dforce_e2e` database only.
 * The agenda reads every order in the database, so each assertion filters to the ids this file seeded;
 * counts are compared as a delta against the value before seeding. Session zone forced to UTC and asserted.
 */
import { execSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rangeFor } from "@/modules/agenda/dates";
import { agendaInWorkshop, agendaOverdue, agendaRange, IN_WORKSHOP_STATUSES } from "@/modules/agenda/queries";
import { orderScope, SYSTEM_SCOPE } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { GET as fullBoardGET } from "../app/api/board/route";
import { GET as customerBoardGET } from "../app/api/board/clientes/route";
import { purgeHistory } from "./purge-history";

type Status = typeof ordenServicio.$inferInsert.status;

const NOW = new Date("2031-03-10T14:00:00Z");
const MIN = 60_000;
const SENTINEL_NAME = "SENTINEL_AGENDA_COMBINED_NAME";
const SENTINEL_PHONE = "50769990077";
const ALL_STATUSES: NonNullable<Status>[] = ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done", "cancelled"];

describe("agenda combined view and Vencidas panel (E2E)", () => {
  const stamp = Date.now();
  const plate = `CB${stamp}`;
  let adminId: string;
  let clienteId: string;
  let vehiculoId: string;
  const mine = new Set<string>();
  const extraUsers: string[] = [];
  const extraTecnicos: string[] = [];

  const newTecnico = async (nombre: string, deactivated = false) => {
    const [t] = await db.insert(tecnico).values({ nombre, deactivatedAt: deactivated ? new Date(NOW) : null }).returning({ id: tecnico.id });
    extraTecnicos.push(t.id);
    return t.id;
  };
  const newOrder = async (o: { status?: Status; at?: Date | string | null; noVehicle?: boolean; createdAt?: Date }) => {
    const status = o.status ?? "booked";
    const [row] = await db
      .insert(ordenServicio)
      .values({
        clienteId,
        vehiculoId: o.noVehicle ? null : vehiculoId,
        categoria: o.noVehicle ? null : "revisado",
        esperaMotivo: status === "on_hold" ? "repuesto" : undefined,
        status,
        appointmentAt: o.at ? new Date(o.at) : null,
        createdAt: o.createdAt,
        completedAt: status === "done" ? new Date(NOW) : null,
      })
      .returning({ id: ordenServicio.id });
    mine.add(row.id);
    return row.id;
  };
  const history = (ordenId: string, fromStatus: Status | null, toStatus: NonNullable<Status>, changedAt: Date) =>
    db.insert(ordenEstadoHistorial).values({ ordenId, fromStatus, toStatus, changedAt });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const workshop = async (cap?: number) => {
    const page = await agendaInWorkshop(SYSTEM_SCOPE, cap);
    return { ...page, rows: page.rows.filter((r) => mine.has(r.id)) };
  };
  const fromHeaders = (path: string, role: string) => new NextRequest(`http://localhost${path}`, { headers: { "x-user-id": adminId, "x-user-role": role } });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    db.$client.on("connect", (c) => void c.query("SET TIME ZONE 'UTC'"));
    const [zone] = (await db.execute(sql`SHOW timezone`)).rows as { TimeZone: string }[];
    expect(zone.TimeZone).toBe("UTC");

    const [u] = await db.insert(users).values({ username: `e2e-agenda-cmb-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    adminId = u.id;
    const [c] = await db.insert(cliente).values({ name: SENTINEL_NAME, phone: SENTINEL_PHONE }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate, make: "Toyota", model: "Hilux", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, [...mine]));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, extraTecnicos));
    await db.delete(users).where(inArray(users.id, [adminId, ...extraUsers]));
    await db.$client.end();
  });

  it("In-workshop set: eight statuses give exactly the five working ones, whatever the appointment date, with customer data (the DB forbids a received order without a vehicle, so the plate is always there)", async () => {
    const byStatus: Record<string, string> = {};
    // Different appointment days, and none at all: the in-workshop list must not care.
    for (const [i, status] of ALL_STATUSES.entries()) byStatus[status] = await newOrder({ status, at: i % 2 ? "2031-08-01T10:00:00-05:00" : null });

    const { rows } = await workshop();

    expect(rows.map((r) => r.status).sort()).toEqual([...IN_WORKSHOP_STATUSES].sort());
    for (const out of ["booked", "done", "cancelled"]) expect(ids(rows)).not.toContain(byStatus[out]);
    const held = rows.find((r) => r.id === byStatus.on_hold)!;
    expect(held).toMatchObject({ esperaMotivo: "repuesto", customerName: SENTINEL_NAME, customerPhone: SENTINEL_PHONE, vehiclePlate: plate });
    expect(rows.find((r) => r.id === byStatus.in_progress)!.esperaMotivo).toBeNull();
  });

  it("Selected day and live orders together: a booked appointment on the day and an in_progress order from another day are both read", async () => {
    const booked = await newOrder({ status: "booked", at: "2031-09-15T10:00:00-05:00" });
    const live = await newOrder({ status: "in_progress", at: "2031-01-02T10:00:00-05:00" });

    const day = await agendaRange(SYSTEM_SCOPE, rangeFor("combined", "2031-09-15"));
    const shop = await workshop();

    expect(ids(day.rows)).toContain(booked);
    expect(ids(day.rows)).not.toContain(live);
    expect(ids(shop.rows)).toContain(live);
    expect(ids(shop.rows)).not.toContain(booked);
  });

  it("Row cap is disclosed: the in-workshop read returns cap rows and truncated when there are more", async () => {
    await newOrder({ status: "open" });
    await newOrder({ status: "diagnosing" });
    await newOrder({ status: "in_progress" });

    const page = await agendaInWorkshop(SYSTEM_SCOPE, 2);

    expect(page.rows).toHaveLength(2);
    expect(page.truncated).toBe(true);
  });

  it("Scope: a técnico reads only the in-workshop orders assigned to them", async () => {
    const [tu] = await db.insert(users).values({ username: `e2e-agenda-cmb-tec-${stamp}`, passwordHash: "x", role: "tecnico" }).returning({ id: users.id });
    extraUsers.push(tu.id);
    const [t] = await db.insert(tecnico).values({ nombre: `Combined Tec ${stamp}`, userId: tu.id }).returning({ id: tecnico.id });
    extraTecnicos.push(t.id);
    const assigned = await newOrder({ status: "diagnosing" });
    const stranger = await newOrder({ status: "diagnosing" });
    await db.insert(ordenTecnico).values({ ordenId: assigned, tecnicoId: t.id, assignedBy: adminId });

    const got = await agendaInWorkshop(orderScope({ id: tu.id, role: "tecnico" }));

    expect(ids(got.rows)).toEqual([assigned]);
    expect(ids(got.rows)).not.toContain(stranger);
  });

  it("Count is the true count: three Vencidas, one inside the visible range, all listed and counted; a cancelled one leaves", async () => {
    const before = (await agendaOverdue(SYSTEM_SCOPE, NOW)).total;
    const inRange = await newOrder({ at: new Date(NOW.getTime() - 2 * 60 * MIN) });
    const old = await newOrder({ at: new Date(NOW.getTime() - 40 * 24 * 60 * MIN) });
    const older = await newOrder({ at: new Date(NOW.getTime() - 60 * 24 * 60 * MIN), noVehicle: true });

    const page = await agendaOverdue(SYSTEM_SCOPE, NOW);

    expect(page.total - before).toBe(3);
    expect(ids(page.rows.filter((r) => mine.has(r.id)))).toEqual([older, old, inRange]);
    const visible = await agendaRange(SYSTEM_SCOPE, rangeFor("day", "2031-03-10"));
    expect(ids(visible.rows)).toContain(inRange);
    expect(ids(visible.rows)).not.toContain(old);

    await db.update(ordenServicio).set({ status: "cancelled" }).where(eq(ordenServicio.id, old));
    const after = await agendaOverdue(SYSTEM_SCOPE, NOW);

    expect(after.total - before).toBe(2);
    expect(ids(after.rows)).not.toContain(old);
  });

  it("Time in status uses the history row: created 5 days ago, moved to in_progress 3 h ago -> 3 h; with no history it falls back to created_at", async () => {
    const created = new Date(Date.now() - 5 * 24 * 60 * MIN);
    const moved = new Date(Date.now() - 3 * 60 * MIN);
    const withHistory = await newOrder({ status: "in_progress", createdAt: created });
    await history(withHistory, null, "open", created);
    await history(withHistory, "open", "in_progress", moved);
    const noHistory = await newOrder({ status: "open", createdAt: created });

    const rows = (await workshop()).rows;

    expect(rows.find((r) => r.id === withHistory)!.sinceAt.getTime()).toBe(moved.getTime());
    expect(rows.find((r) => r.id === noHistory)!.sinceAt.getTime()).toBe(created.getTime());
    expect(rows.find((r) => r.id === withHistory)!.holdSinceAt).toBeNull();
  });

  it("Hold since: the LATEST '-> on_hold' row, not an earlier hold", async () => {
    const day = 24 * 60 * MIN;
    const base = Date.now();
    const t = (ago: number) => new Date(base - ago);
    const held = await newOrder({ status: "on_hold", createdAt: t(6 * day) });
    await history(held, "in_progress", "on_hold", t(5 * day));
    await history(held, "on_hold", "in_progress", t(4 * day));
    await history(held, "in_progress", "on_hold", t(1 * day));

    const rows = (await workshop()).rows;

    const heldRow = rows.find((r) => r.id === held)!;
    expect(heldRow.holdSinceAt!.getTime()).toBe(t(1 * day).getTime());
    expect(heldRow.sinceAt.getTime()).toBe(heldRow.holdSinceAt!.getTime());
  });

  it("Technicians and vehicle on the in-workshop row: make, model, category, active technicians by name; a deactivated one is off", async () => {
    const id = await newOrder({ status: "diagnosing" });
    const marta = await newTecnico(`Marta ${stamp}`);
    const julio = await newTecnico(`Julio ${stamp}`);
    const baja = await newTecnico(`Baja ${stamp}`, true);
    await db.insert(ordenTecnico).values([marta, julio, baja].map((tecnicoId) => ({ ordenId: id, tecnicoId, assignedBy: adminId })));

    const rows = (await workshop()).rows;

    expect(rows.find((r) => r.id === id)).toMatchObject({
      vehicleMake: "Toyota",
      vehicleModel: "Hilux",
      categoria: "revisado",
      technicians: [{ id: julio, nombre: `Julio ${stamp}` }, { id: marta, nombre: `Marta ${stamp}` }],
    });
  });

  it("Board payload still carries no customer data: both board bodies lack the sentinel name and phone", async () => {
    await newOrder({ status: "open" });
    expect(ids((await workshop()).rows).length).toBeGreaterThan(0); // the agenda DOES carry the sentinel, so the absences below mean something

    const full = await (await fullBoardGET(fromHeaders("/api/board", "jefe_taller"))).text();
    const customer = await (await customerBoardGET(fromHeaders("/api/board/clientes", "pantalla"))).text();

    for (const body of [full, customer]) {
      expect(body).toContain(plate);
      expect(body).not.toContain(SENTINEL_NAME);
      expect(body).not.toContain(SENTINEL_PHONE);
    }
  });
});
