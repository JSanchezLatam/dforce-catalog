/**
 * Real-SQL proof for workshop-agenda WU2. The unit tests cannot see a WHERE, a join or a bound; this file
 * runs `agendaRange` and `agendaOverdue` against a THROWAWAY database (`dforce_e2e`). The session zone is
 * forced to UTC and asserted, so a bound that leaned on the zone would shift here. The agenda reads every
 * appointment in the database, so each assertion filters to the ids this file seeded; the overdue count
 * is compared as a delta against its value before seeding.
 */
import { execSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rangeFor } from "@/modules/agenda/dates";
import { agendaOverdue, agendaRange } from "@/modules/agenda/queries";
import { orderScope, SYSTEM_SCOPE } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { purgeHistory } from "./purge-history";

type Status = typeof ordenServicio.$inferInsert.status;

const NOW = new Date("2031-03-10T14:00:00Z");
const MIN = 60_000;
const NAME = "Agenda E2E Cliente";
const PHONE = "50761234567";

describe("agenda queries (E2E)", () => {
  const stamp = Date.now();
  let adminId: string;
  let clienteId: string;
  let vehiculoId: string;
  const mine = new Set<string>();
  const extraUsers: string[] = [];
  const extraTecnicos: string[] = [];

  const newOrder = async (o: { status?: Status; at: string | Date | null; noVehicle?: boolean }) => {
    const status = o.status ?? "booked";
    const [row] = await db
      .insert(ordenServicio)
      .values({
        clienteId,
        vehiculoId: o.noVehicle ? null : vehiculoId,
        categoria: o.noVehicle ? null : "revisado",
        esperaMotivo: status === "on_hold" ? "repuesto" : undefined,
        status,
        appointmentAt: o.at === null ? null : new Date(o.at),
        completedAt: status === "done" ? new Date(NOW) : null,
      })
      .returning({ id: ordenServicio.id });
    mine.add(row.id);
    return row.id;
  };
  const range = async (view: "day" | "week" | "month" | "combined", date: string, cap?: number) => {
    const page = await agendaRange(SYSTEM_SCOPE, rangeFor(view, date), cap);
    return { ...page, rows: page.rows.filter((r) => mine.has(r.id)) };
  };
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    // Force every pooled connection to UTC before the first query; `SET` is queued ahead of it on that client.
    db.$client.on("connect", (c) => void c.query("SET TIME ZONE 'UTC'"));
    const [zone] = (await db.execute(sql`SHOW timezone`)).rows as { TimeZone: string }[];
    expect(zone.TimeZone).toBe("UTC");

    const [u] = await db.insert(users).values({ username: `e2e-agenda-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    adminId = u.id;
    const [c] = await db.insert(cliente).values({ name: NAME, phone: PHONE }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `AG${stamp}`, make: "Toyota", model: "Hilux", motor: "combustion" }).returning({ id: vehiculo.id });
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

  // Tests share the seeded set on purpose: each one adds its rows on its own day and asserts on its own ids.

  it("Panama midnight boundary: 23:59 Panama on D is in, 00:00 Panama on D+1 is out, with the session in UTC", async () => {
    const inStart = await newOrder({ at: "2031-03-10T05:00:00Z" }); // 00:00 Panama on D
    const inLate = await newOrder({ at: "2031-03-10T23:59:00-05:00" }); // 23:59 Panama on D
    const inUtcSpelling = await newOrder({ at: "2031-03-11T04:59:59Z" }); // 23:59:59 Panama on D, already D+1 in UTC
    const outBefore = await newOrder({ at: "2031-03-10T04:59:59Z" }); // 23:59:59 Panama on D-1
    const outNext = await newOrder({ at: "2031-03-11T05:00:00Z" }); // 00:00 Panama on D+1
    const outAfter = await newOrder({ at: "2031-03-12T05:00:00Z" }); // 00:00 Panama on D+2

    const got = ids((await range("day", "2031-03-10")).rows);

    expect(got.sort()).toEqual([inStart, inLate, inUtcSpelling].sort());
    for (const out of [outBefore, outNext, outAfter]) expect(got).not.toContain(out);
  });

  it("Month range covers the drawn weeks: the leading Monday of a Thursday-first month is returned, the day after the grid is not", async () => {
    // May 2031 starts on a Thursday and ends on a Saturday: the grid runs Monday 2031-04-28 to Sunday 2031-06-01.
    const leadingMonday = await newOrder({ at: "2031-04-28T10:00:00-05:00" });
    const trailingSunday = await newOrder({ at: "2031-06-01T20:00:00-05:00" });
    const inMonth = await newOrder({ at: "2031-05-15T10:00:00-05:00" });
    const beforeGrid = await newOrder({ at: "2031-04-27T20:00:00-05:00" });
    const afterGrid = await newOrder({ at: "2031-06-02T00:00:00-05:00" });

    const got = ids((await range("month", "2031-05-15")).rows);

    expect(got.sort()).toEqual([leadingMonday, trailingSunday, inMonth].sort());
    expect(got).not.toContain(beforeGrid);
    expect(got).not.toContain(afterGrid);
  });

  it("Status visibility: all eight statuses on one day return seven, cancelled absent", async () => {
    const byStatus: Record<string, string> = {};
    for (const status of ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done", "cancelled"] as const) {
      byStatus[status] = await newOrder({ status, at: "2031-07-10T10:00:00-05:00" });
    }

    const rows = (await range("day", "2031-07-10")).rows;

    expect(rows.map((r) => r.status).sort()).toEqual(["booked", "diagnosing", "done", "in_progress", "on_hold", "open", "ready_for_review"]);
    expect(ids(rows)).not.toContain(byStatus.cancelled);
  });

  it("Order without an appointment is absent from the range and from the overdue list", async () => {
    const openNoDate = await newOrder({ status: "open", at: null });
    const bookedNoDate = await newOrder({ status: "booked", at: null, noVehicle: true });

    const day = ids((await range("day", "2031-07-11")).rows);
    const week = ids((await range("month", "2031-07-11")).rows);
    const overdue = ids((await agendaOverdue(SYSTEM_SCOPE, NOW)).rows);

    for (const id of [openNoDate, bookedNoDate]) {
      expect(day).not.toContain(id);
      expect(week).not.toContain(id);
      expect(overdue).not.toContain(id);
    }
  });

  it("Chip data: customer name and phone and the plate are present; a no-vehicle order has a null plate and is still returned", async () => {
    const withCar = await newOrder({ at: "2031-08-04T09:00:00-05:00" });
    const noCar = await newOrder({ at: "2031-08-04T10:00:00-05:00", noVehicle: true });

    const rows = (await range("day", "2031-08-04")).rows;

    expect(rows.find((r) => r.id === withCar)).toMatchObject({ customerName: NAME, customerPhone: PHONE, vehiclePlate: `AG${stamp}`, status: "booked" });
    expect(rows.find((r) => r.id === noCar)).toMatchObject({ customerName: NAME, customerPhone: PHONE, vehiclePlate: null });
  });

  it("Overlap order: equal start times are ordered by id, earlier starts first", async () => {
    const a = await newOrder({ at: "2031-08-05T09:00:00-05:00" });
    const b = await newOrder({ at: "2031-08-05T09:00:00-05:00" });
    const c = await newOrder({ at: "2031-08-05T08:00:00-05:00" });

    const got = ids((await range("day", "2031-08-05")).rows);

    expect(got).toEqual([c, ...[a, b].sort()]);
  });

  it("Row cap is disclosed: 501 rows return 500 and truncated; exactly the cap is not truncated", async () => {
    const at = new Date("2031-09-10T15:00:00Z");
    const created = await db
      .insert(ordenServicio)
      .values(Array.from({ length: 501 }, () => ({ clienteId, vehiculoId, categoria: "revisado" as const, status: "booked" as const, appointmentAt: at })))
      .returning({ id: ordenServicio.id });
    for (const { id } of created) mine.add(id);

    const full = await agendaRange(SYSTEM_SCOPE, rangeFor("day", "2031-09-10"));
    expect(full.rows).toHaveLength(500);
    expect(full.truncated).toBe(true);

    for (let i = 0; i < 3; i++) await newOrder({ at: "2031-09-11T10:00:00-05:00" });
    const small = await range("day", "2031-09-11", 2);
    expect(small.rows).toHaveLength(2);
    expect(small.truncated).toBe(true);
    const exact = await range("day", "2031-09-11", 3);
    expect(exact.rows).toHaveLength(3);
    expect(exact.truncated).toBe(false);
  });

  it("Margin boundary in SQL: 59 and exactly 60 minutes old are out, 61 is in; a non-booked past order is out", async () => {
    const before = (await agendaOverdue(SYSTEM_SCOPE, NOW)).total;
    const m59 = await newOrder({ at: new Date(NOW.getTime() - 59 * MIN) });
    const m60 = await newOrder({ at: new Date(NOW.getTime() - 60 * MIN) });
    const m61 = await newOrder({ at: new Date(NOW.getTime() - 61 * MIN) });
    const openPast = await newOrder({ status: "open", at: new Date(NOW.getTime() - 180 * MIN) });

    const page = await agendaOverdue(SYSTEM_SCOPE, NOW);
    // Rows other tests seeded earlier on 2031-03-10 are overdue too; only this test's ids matter.
    const got = ids(page.rows.filter((r) => [m59, m60, m61, openPast].includes(r.id)));

    expect(got).toEqual([m61]);
    for (const out of [m59, m60, openPast]) expect(got).not.toContain(out);
    expect(page.total - before).toBe(1);
  });

  it("Old overdue appointment never disappears: a 40-day-old booked order is overdue whatever the visible range, oldest first", async () => {
    const before = (await agendaOverdue(SYSTEM_SCOPE, NOW)).total;
    const old = await newOrder({ at: new Date(NOW.getTime() - 40 * 24 * 60 * MIN), noVehicle: true });
    const recent = await newOrder({ at: new Date(NOW.getTime() - 2 * 60 * MIN) });

    const page = await agendaOverdue(SYSTEM_SCOPE, NOW);
    const got = ids(page.rows.filter((r) => [old, recent].includes(r.id)));
    const inRange = ids((await range("week", "2031-03-10")).rows);

    expect(got).toEqual([old, recent]);
    expect(inRange).not.toContain(old);
    expect(page.rows.find((r) => r.id === old)).toMatchObject({ customerName: NAME, customerPhone: PHONE, vehiclePlate: null });
    expect(page.total - before).toBe(2);
  });

  it("Overdue total is a number, not a string, and the true count past the cap", async () => {
    await newOrder({ at: new Date(NOW.getTime() - 3 * 60 * MIN) });
    await newOrder({ at: new Date(NOW.getTime() - 4 * 60 * MIN) });
    const page = await agendaOverdue(SYSTEM_SCOPE, NOW, 1);

    expect(typeof page.total).toBe("number");
    expect(page.rows).toHaveLength(1);
    expect(page.truncated).toBe(true);
    expect(page.total).toBeGreaterThan(1);
  });

  it("Scope: a técnico sees only the orders assigned to them, in the range, in the overdue rows and in the overdue count", async () => {
    const [tu] = await db.insert(users).values({ username: `e2e-agenda-tec-${stamp}`, passwordHash: "x", role: "tecnico" }).returning({ id: users.id });
    extraUsers.push(tu.id);
    const [t] = await db.insert(tecnico).values({ nombre: `Agenda Tec ${stamp}`, userId: tu.id }).returning({ id: tecnico.id });
    extraTecnicos.push(t.id);
    const assigned = await newOrder({ at: "2031-10-06T09:00:00-05:00" });
    const stranger = await newOrder({ at: "2031-10-06T09:30:00-05:00" });
    const assignedOverdue = await newOrder({ at: new Date(NOW.getTime() - 5 * 60 * MIN) });
    await db.insert(ordenTecnico).values([
      { ordenId: assigned, tecnicoId: t.id, assignedBy: adminId },
      { ordenId: assignedOverdue, tecnicoId: t.id, assignedBy: adminId },
    ]);
    const scope = orderScope({ id: tu.id, role: "tecnico" });

    const got = await agendaRange(scope, rangeFor("day", "2031-10-06"));
    const overdue = await agendaOverdue(scope, NOW);

    expect(ids(got.rows)).toEqual([assigned]);
    expect(ids(got.rows)).not.toContain(stranger);
    expect(ids(overdue.rows)).toEqual([assignedOverdue]);
    expect(overdue.total).toBe(1);
  });
});
