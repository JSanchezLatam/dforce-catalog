/**
 * Real-SQL proof for metrics-dashboard WU1. The unit tests shape rows they
 * invented; the value of these queries is a time-zone bucket, a `WHERE` and a
 * `GROUP BY`, which only Postgres proves. Run against a THROWAWAY database
 * (`dforce_e2e`) — never the dev one. Every row lives in 2031 and each query
 * is windowed to it, so rows other e2e files left behind cannot leak in.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenLineaTrabajo, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { findTecnicoByUserId } from "../modules/technicians/queries";
import { backlogByStatus, closedByMonth, closedByTecnicoMonth, minutesByTecnicoMonth, receivedByMonth } from "../modules/metrics/queries";

describe("metrics queries (E2E)", () => {
  const stamp = Date.now();
  let adminId: string;
  let rosterA: string;
  let rosterB: string;
  let loginA: string;
  let loginUnlinked: string;
  let clienteId: string;
  let vehiculoId: string;
  const FROM = "2031-01";

  const newOrder = async (o: { status: typeof ordenServicio.$inferInsert.status; createdAt: string; completedAt?: string; assign?: string[] }) => {
    const [row] = await db
      .insert(ordenServicio)
      .values({
        clienteId,
        vehiculoId,
        categoria: "revisado",
        status: o.status,
        createdAt: new Date(o.createdAt),
        completedAt: o.completedAt ? new Date(o.completedAt) : null,
      })
      .returning({ id: ordenServicio.id });
    for (const tecnicoId of o.assign ?? []) await db.insert(ordenTecnico).values({ ordenId: row.id, tecnicoId, assignedBy: adminId });
    return row.id;
  };
  const addMinutes = (ordenId: string, tecnicoId: string, duracionMinutos: number, fecha: string) =>
    db.insert(ordenLineaTrabajo).values({ ordenId, tecnicoId, descripcion: "seed", duracionMinutos, fecha, createdBy: adminId });
  const inMonth = <T extends { mes: string }>(rows: T[], mes: string) => rows.filter((r) => r.mes === mes);

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-metrics-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    adminId = u.id;
    const [la] = await db.insert(users).values({ username: `e2e-metrics-a-${stamp}`, passwordHash: "x", role: "tecnico" }).returning({ id: users.id });
    const [lu] = await db.insert(users).values({ username: `e2e-metrics-u-${stamp}`, passwordHash: "x", role: "tecnico" }).returning({ id: users.id });
    loginA = la.id;
    loginUnlinked = lu.id;
    const roster = async (nombre: string, userId?: string) =>
      (await db.insert(tecnico).values({ nombre, userId }).returning({ id: tecnico.id }))[0].id;
    rosterA = await roster("Metrics A", loginA);
    rosterB = await roster("Metrics B");
    const [c] = await db.insert(cliente).values({ name: "Metrics Cliente", phone: "50769994004" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "MT0001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) {
      await db.delete(ordenLineaTrabajo).where(inArray(ordenLineaTrabajo.ordenId, orders));
      await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    }
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [rosterA, rosterB]));
    await db.delete(users).where(inArray(users.id, [adminId, loginA, loginUnlinked]));
    await db.$client.end();
  });

  it("the Panama boundary: 04:59Z on Mar 1 closes in February, 05:00Z closes in March", async () => {
    await newOrder({ status: "done", createdAt: "2031-02-10T12:00:00Z", completedAt: "2031-03-01T04:59:00Z", assign: [rosterA] });
    await newOrder({ status: "done", createdAt: "2031-02-10T12:00:00Z", completedAt: "2031-03-01T05:00:00Z", assign: [rosterA] });

    const closed = await closedByTecnicoMonth({ from: FROM, tecnicoId: rosterA });
    expect(inMonth(closed, "2031-02")).toEqual([{ tecnicoId: rosterA, mes: "2031-02", n: 1 }]);
    expect(inMonth(closed, "2031-03")).toEqual([{ tecnicoId: rosterA, mes: "2031-03", n: 1 }]);
  });

  it("the same boundary buckets received (created_at)", async () => {
    await newOrder({ status: "open", createdAt: "2031-04-01T04:59:00Z" });
    await newOrder({ status: "open", createdAt: "2031-04-01T05:00:00Z" });

    const received = await receivedByMonth({ from: FROM });
    expect(received.find((r) => r.mes === "2031-03")?.n).toBe(1);
    expect(received.find((r) => r.mes === "2031-04")?.n).toBe(1);
  });

  it("two assignees on one order get 1 each while the order total is 1", async () => {
    await newOrder({ status: "done", createdAt: "2031-06-02T12:00:00Z", completedAt: "2031-06-10T12:00:00Z", assign: [rosterA, rosterB] });

    const june = inMonth(await closedByTecnicoMonth({ from: FROM }), "2031-06").filter((r) => [rosterA, rosterB].includes(r.tecnicoId));
    expect(june.map((r) => r.n)).toEqual([1, 1]);
    expect(inMonth(await closedByMonth({ from: FROM }), "2031-06")).toEqual([{ mes: "2031-06", n: 1 }]);
  });

  it("a cancelled order counts as received only, never closed", async () => {
    await newOrder({ status: "cancelled", createdAt: "2031-07-05T12:00:00Z", completedAt: "2031-07-06T12:00:00Z", assign: [rosterA] });

    expect(inMonth(await receivedByMonth({ from: FROM }), "2031-07")).toEqual([{ mes: "2031-07", n: 1 }]);
    expect(inMonth(await closedByMonth({ from: FROM }), "2031-07")).toEqual([]);
    expect(inMonth(await closedByTecnicoMonth({ from: FROM, tecnicoId: rosterA }), "2031-07")).toEqual([]);
  });

  it("the lower bound excludes older rows and includes the first instant of the window", async () => {
    await newOrder({ status: "done", createdAt: "2030-12-01T12:00:00Z", completedAt: "2031-01-01T04:59:00Z", assign: [rosterB] }); // Dec 31 in Panama
    await newOrder({ status: "done", createdAt: "2030-12-01T12:00:00Z", completedAt: "2031-01-01T05:00:00Z", assign: [rosterB] }); // Jan 1 in Panama

    const rows = await closedByTecnicoMonth({ from: FROM, tecnicoId: rosterB });
    expect(rows.map((r) => r.mes)).not.toContain("2030-12");
    expect(inMonth(rows, "2031-01")).toEqual([{ tecnicoId: rosterB, mes: "2031-01", n: 1 }]);
  });

  it("minutes sum per technician and month by `fecha`, bucketed as-is", async () => {
    const orden = await newOrder({ status: "in_progress", createdAt: "2031-08-01T12:00:00Z", assign: [rosterA, rosterB] });
    await addMinutes(orden, rosterA, 120, "2031-08-31");
    await addMinutes(orden, rosterA, 150, "2031-08-01");
    await addMinutes(orden, rosterA, 60, "2031-09-01");
    await addMinutes(orden, rosterB, 45, "2031-08-15");
    await addMinutes(orden, rosterB, 30, "2030-12-31"); // before the window

    const all = await minutesByTecnicoMonth({ from: FROM });
    expect(all.filter((r) => r.mes === "2031-08" && r.tecnicoId === rosterA)).toEqual([{ tecnicoId: rosterA, mes: "2031-08", n: 270 }]);
    expect(all.find((r) => r.mes === "2031-09" && r.tecnicoId === rosterA)?.n).toBe(60);
    expect(all.find((r) => r.tecnicoId === rosterB && r.mes === "2031-08")?.n).toBe(45);
    expect(all.map((r) => r.mes)).not.toContain("2030-12");
  });

  it("the tecnicoId filter returns only that technician's rows, closed and minutes", async () => {
    const closed = await closedByTecnicoMonth({ from: FROM, tecnicoId: rosterB });
    const minutes = await minutesByTecnicoMonth({ from: FROM, tecnicoId: rosterB });
    expect(closed.length).toBeGreaterThan(0);
    expect(minutes.length).toBeGreaterThan(0);
    expect(new Set([...closed, ...minutes].map((r) => r.tecnicoId))).toEqual(new Set([rosterB]));
  });

  it("the técnico's own page path: the session's login resolves A, and A's id returns only A's closed and minutes", async () => {
    const me = await findTecnicoByUserId(loginA);
    expect(me).toEqual({ id: rosterA });

    const closed = await closedByTecnicoMonth({ from: FROM, tecnicoId: me!.id });
    const minutes = await minutesByTecnicoMonth({ from: FROM, tecnicoId: me!.id });
    expect(closed.length).toBeGreaterThan(0);
    expect(minutes.length).toBeGreaterThan(0);
    expect(new Set([...closed, ...minutes].map((r) => r.tecnicoId))).toEqual(new Set([rosterA]));
    // B also closed in June (shared order) and logged 45 min in August: neither may show up as A's.
    expect(inMonth(closed, "2031-06")).toEqual([{ tecnicoId: rosterA, mes: "2031-06", n: 1 }]);
    expect(minutes.find((r) => r.mes === "2031-08")?.n).toBe(270);
  });

  it("a login with no roster row resolves no technician", async () => {
    expect(await findTecnicoByUserId(loginUnlinked)).toBeNull();
  });

  it("backlog counts open, in_progress and ready_for_review as integers, never done or cancelled", async () => {
    const before = Object.fromEntries((await backlogByStatus()).map((r) => [r.status, r.n]));
    await newOrder({ status: "open", createdAt: "2031-10-01T12:00:00Z" });
    await newOrder({ status: "in_progress", createdAt: "2031-10-01T12:00:00Z" });
    await newOrder({ status: "in_progress", createdAt: "2031-10-01T12:00:00Z" });
    await newOrder({ status: "done", createdAt: "2031-10-01T12:00:00Z", completedAt: "2031-10-02T12:00:00Z" });
    await newOrder({ status: "cancelled", createdAt: "2031-10-01T12:00:00Z" });

    const after = await backlogByStatus();
    expect(after.every((r) => typeof r.n === "number")).toBe(true);
    expect(after.map((r) => r.status).every((s) => ["open", "in_progress", "ready_for_review"].includes(s))).toBe(true);
    const delta = (s: string) => (after.find((r) => r.status === s)?.n ?? 0) - (before[s] ?? 0);
    expect(delta("open")).toBe(1);
    expect(delta("in_progress")).toBe(2);
  });
});
