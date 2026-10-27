/**
 * Real-SQL proof for workshop-status-board WU2. The unit tests shape rows they
 * invented; the value of these queries is a `WHERE`, a left join, a `max()` and
 * a Panama day boundary, which only Postgres proves. Run against a THROWAWAY
 * database (`dforce_e2e`). The board reads every open order in the database, so
 * each assertion filters to the ids this file seeded.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { customerBoardOrders, workshopBoardData } from "../modules/board/queries";
import { toBoardSnapshot, toCustomerSnapshot } from "../modules/board/shape";
import { purgeHistory } from "./purge-history";

type Status = typeof ordenServicio.$inferInsert.status;

// 09:00 in Panama (UTC-5, no DST) on 2031-03-10.
const NOW = new Date("2031-03-10T14:00:00Z");
const SENTINEL_NAME = "SENTINEL_BOARD_CUSTOMER_NAME";
const SENTINEL_PHONE = "50769990001";

describe("workshop board queries (E2E)", () => {
  const stamp = Date.now();
  let adminId: string;
  let clienteId: string;
  let vehiculoId: string;
  let techA: string;
  let techB: string;
  const mine = new Set<string>();

  const newOrder = async (o: { status: Status; completedAt?: string; updatedAt?: string; noVehicle?: boolean; assign?: string[]; appointmentAt?: string }) => {
    const [row] = await db
      .insert(ordenServicio)
      .values({
        clienteId,
        vehiculoId: o.noVehicle ? null : vehiculoId,
        categoria: o.noVehicle ? null : "revisado",
        esperaMotivo: o.status === "on_hold" ? "repuesto" : undefined,
        status: o.status,
        appointmentAt: o.appointmentAt ? new Date(o.appointmentAt) : undefined,
        completedAt: o.completedAt ? new Date(o.completedAt) : null,
        updatedAt: o.updatedAt ? new Date(o.updatedAt) : undefined,
      })
      .returning({ id: ordenServicio.id });
    for (const tecnicoId of o.assign ?? []) await db.insert(ordenTecnico).values({ ordenId: row.id, tecnicoId, assignedBy: adminId });
    mine.add(row.id);
    return row.id;
  };
  const history = (ordenId: string, changedAt: string) =>
    db.insert(ordenEstadoHistorial).values({ ordenId, toStatus: "open", changedAt: new Date(changedAt) });
  const fullBoard = async () => {
    const data = await workshopBoardData(NOW);
    return { ...data, rows: data.rows.filter((r) => mine.has(r.id)) };
  };
  const customerRows = async () => (await customerBoardOrders(NOW)).filter((r) => mine.has(r.id));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-board-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    adminId = u.id;
    const [c] = await db.insert(cliente).values({ name: SENTINEL_NAME, phone: SENTINEL_PHONE }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `BD${stamp}`, make: "Toyota", model: "Hilux", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
    const roster = async (nombre: string) => (await db.insert(tecnico).values({ nombre }).returning({ id: tecnico.id }))[0].id;
    techA = await roster(`Board Ana ${stamp}`);
    techB = await roster(`Board Beto ${stamp}`);
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, [...mine]));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [techA, techB]));
    await db.delete(users).where(eq(users.id, adminId));
    await db.$client.end();
  });

  // Tests share the seeded set on purpose: each one adds its rows and asserts on its own ids.

  it("Statuses included and excluded: the full board returns the seven non-cancelled, the customer query hides booked and cancelled", async () => {
    const ids: Record<string, string> = {};
    for (const status of ["booked", "open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "cancelled"] as const) ids[status] = await newOrder({ status });
    ids.done = await newOrder({ status: "done", completedAt: "2031-03-10T13:00:00Z" });

    const statusOf = (rows: { id: string; status: string }[]) => rows.filter((r) => Object.values(ids).includes(r.id)).map((r) => r.status).sort();

    expect(statusOf((await fullBoard()).rows)).toEqual(["booked", "diagnosing", "done", "in_progress", "on_hold", "open", "ready_for_review"]);
    expect(statusOf(await customerRows())).toEqual(["diagnosing", "done", "in_progress", "on_hold", "open", "ready_for_review"]);
  });

  it("Done yesterday is dropped at Panama midnight: 23:30 yesterday out, 00:30 today in", async () => {
    const yesterday = await newOrder({ status: "done", completedAt: "2031-03-10T04:30:00Z" }); // 23:30 on Mar 9 in Panama
    const today = await newOrder({ status: "done", completedAt: "2031-03-10T05:30:00Z" }); // 00:30 on Mar 10 in Panama

    const full = (await fullBoard()).rows.map((r) => r.id);
    const customer = (await customerRows()).map((r) => r.id);

    expect(full).toContain(today);
    expect(full).not.toContain(yesterday);
    expect(customer).toContain(today);
    expect(customer).not.toContain(yesterday);
  });

  it("Latest history row wins, the fallback is updated_at, and another order's history is not counted", async () => {
    const withHistory = await newOrder({ status: "open", updatedAt: "2031-03-01T00:00:00Z" });
    const noHistory = await newOrder({ status: "open", updatedAt: "2031-03-02T08:00:00Z" });
    const neighbour = await newOrder({ status: "open", updatedAt: "2031-03-01T00:00:00Z" });
    await history(withHistory, "2031-03-10T09:00:00Z");
    await history(withHistory, "2031-03-10T12:00:00Z");
    await history(neighbour, "2031-03-10T13:30:00Z");

    const { rows, techs, since } = await workshopBoardData(NOW);
    const byId = new Map(since.map((s) => [s.ordenId, s.changedAt.toISOString()]));
    const snapshot = toBoardSnapshot(rows.filter((r) => [withHistory, noHistory].includes(r.id)), techs, since, NOW);

    expect(byId.get(withHistory)).toBe("2031-03-10T12:00:00.000Z");
    expect(byId.has(noHistory)).toBe(false);
    expect(snapshot.rows.map((r) => r.statusSince).sort()).toEqual(["2031-03-02T08:00:00.000Z", "2031-03-10T12:00:00.000Z"]);
  });

  it("technicians are batched per order and never cross orders", async () => {
    const two = await newOrder({ status: "in_progress", assign: [techA, techB] });
    const one = await newOrder({ status: "in_progress", assign: [techB] });

    const { techs } = await fullBoard();

    expect(techs.filter((t) => t.ordenId === two).map((t) => t.nombre)).toEqual([`Board Ana ${stamp}`, `Board Beto ${stamp}`]);
    expect(techs.filter((t) => t.ordenId === one).map((t) => t.nombre)).toEqual([`Board Beto ${stamp}`]);
  });

  it("Booked order without a vehicle is on the full board, absent from the customer query", async () => {
    const id = await newOrder({ status: "booked", noVehicle: true, assign: [techA], appointmentAt: "2031-03-11T15:00:00Z" });

    const { rows, techs, since } = await workshopBoardData(NOW);
    const [booked] = toBoardSnapshot(rows.filter((r) => r.id === id), techs, since, NOW).rows;

    expect(booked).toMatchObject({ plate: "Sin vehículo", statusLabel: "Agendada", technicians: [`Board Ana ${stamp}`], appointmentAt: "2031-03-11T15:00:00.000Z" });
    expect((await customerRows()).map((r) => r.id)).not.toContain(id);
  });

  it("Customer data seeded, payload clean: neither the sentinel name nor the phone reaches either payload", async () => {
    const data = await workshopBoardData(NOW);
    const payloads = JSON.stringify([toBoardSnapshot(data.rows, data.techs, data.since, NOW), toCustomerSnapshot(await customerBoardOrders(NOW), NOW)]);

    expect(payloads).toContain(`BD${stamp}`); // the seeded orders are in the payload, so the absence below means something
    expect(payloads).not.toContain(SENTINEL_NAME);
    expect(payloads).not.toContain(SENTINEL_PHONE);
  });
});
