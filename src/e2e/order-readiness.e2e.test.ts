/**
 * Real-SQL proof for technicians-and-work-lines WU6: "Mi parte lista" takes the
 * order's `FOR UPDATE` lock and recomputes readiness under it. The unit suites
 * inject the transaction, so neither the lock nor the join over `tecnico` is
 * exercised there. Run against a THROWAWAY database (`dforce_e2e`) — never the
 * dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { lockOrderForMutation, OrderClosedError } from "../modules/service-orders/order-lock";
import { markParteLista, ParteListaForbiddenError, unmarkParteLista } from "../modules/service-orders/parte-lista";
import { SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { transitionOrder } from "../modules/service-orders/service";

describe("Mi parte lista and readiness (E2E)", () => {
  const stamp = Date.now();
  const madeUsers: string[] = [];
  const madeRoster: string[] = [];
  let admin: string;
  let clienteId: string;
  let vehiculoId: string;

  const technician = async (suffix: string, deactivatedAt?: Date) => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-ready-${suffix}-${stamp}`, passwordHash: "x", role: "tecnico" })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    const [t] = await db.insert(tecnico).values({ nombre: `Ready ${suffix}`, userId: u.id, deactivatedAt }).returning({ id: tecnico.id });
    madeRoster.push(t.id);
    return { userId: u.id, tecnicoId: t.id };
  };
  const newOrder = async (status: typeof ordenServicio.$inferInsert.status = "in_progress") =>
    (await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status }).returning({ id: ordenServicio.id }))[0].id;
  const assign = (ordenId: string, tecnicoId: string, parteListaAt: Date | null = null) =>
    db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: admin, parteListaAt });
  const statusOf = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0].status;
  const markOf = async (ordenId: string, tecnicoId: string) =>
    (await db.select().from(ordenTecnico).where(eq(ordenTecnico.ordenId, ordenId)).then((rows) => rows.find((r) => r.tecnicoId === tecnicoId)))?.parteListaAt;
  const mark = (ordenId: string, userId: string) => markParteLista({ ordenId, userId, scope: SYSTEM_SCOPE });
  const unmark = (ordenId: string, userId: string) => unmarkParteLista({ ordenId, userId, scope: SYSTEM_SCOPE });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [a] = await db
      .insert(users)
      .values({ username: `e2e-ready-admin-${stamp}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    admin = a.id;
    madeUsers.push(admin);
    const [c] = await db.insert(cliente).values({ name: "Ready Cliente", phone: "50769994003" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "RDY001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, madeRoster));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  it("markParteLista waits for another connection's FOR UPDATE on the order, then resolves ready_for_review", async () => {
    const a = await technician("lock");
    const ordenId = await newOrder();
    await assign(ordenId, a.tecnicoId);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.transaction(async (tx) => {
      await lockOrderForMutation(tx, ordenId, { scope: SYSTEM_SCOPE, canWrite: () => true });
      locked();
      await held;
    });
    await isLocked;

    let settled = false;
    const marking = mark(ordenId, a.userId).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    expect(await statusOf(ordenId)).toBe("in_progress");

    release();
    await holder;
    await expect(marking).resolves.toEqual({ status: "ready_for_review" });
    expect(await statusOf(ordenId)).toBe("ready_for_review");
  });

  it("two simultaneous last marks end ready_for_review, and exactly one of them is the one that made it ready", async () => {
    // One round can pass by luck without the lock (the reads happen to land after the other commit), so repeat it.
    for (let round = 0; round < 10; round++) {
      const a = await technician(`race-a${round}`);
      const b = await technician(`race-b${round}`);
      const ordenId = await newOrder();
      await assign(ordenId, a.tecnicoId);
      await assign(ordenId, b.tecnicoId);

      const results = await Promise.all([mark(ordenId, a.userId), mark(ordenId, b.userId)]);

      expect(results.map((r) => r.status).sort()).toEqual(["in_progress", "ready_for_review"]);
      expect(await statusOf(ordenId)).toBe("ready_for_review");
      expect(await markOf(ordenId, a.tecnicoId)).toBeInstanceOf(Date);
      expect(await markOf(ordenId, b.tecnicoId)).toBeInstanceOf(Date);
    }
  });

  it("a deactivated, unmarked assignee does not block readiness", async () => {
    const a = await technician("off-a");
    const off = await technician("off-b", new Date());
    const ordenId = await newOrder();
    await assign(ordenId, a.tecnicoId);
    await assign(ordenId, off.tecnicoId);

    await expect(mark(ordenId, a.userId)).resolves.toEqual({ status: "ready_for_review" });
  });

  it("un-marking returns a ready order to in_progress and clears only the caller's mark", async () => {
    const a = await technician("un-a");
    const b = await technician("un-b");
    const ordenId = await newOrder("ready_for_review");
    const markedAt = new Date("2026-10-06T10:00:00Z");
    await assign(ordenId, a.tecnicoId, markedAt);
    await assign(ordenId, b.tecnicoId, markedAt);

    await expect(unmark(ordenId, a.userId)).resolves.toEqual({ status: "in_progress" });

    expect(await statusOf(ordenId)).toBe("in_progress");
    expect(await markOf(ordenId, a.tecnicoId)).toBeNull();
    expect((await markOf(ordenId, b.tecnicoId))?.toISOString()).toBe(markedAt.toISOString());
  });

  it("sending a ready order back clears every mark, and re-marking by all active assignees makes it ready again", async () => {
    const a = await technician("back-a");
    const b = await technician("back-b");
    const ordenId = await newOrder("ready_for_review");
    const markedAt = new Date("2026-10-06T10:00:00Z");
    await assign(ordenId, a.tecnicoId, markedAt);
    await assign(ordenId, b.tecnicoId, markedAt);

    await transitionOrder(ordenId, "in_progress", { scope: SYSTEM_SCOPE, canAssign: true });

    expect(await statusOf(ordenId)).toBe("in_progress");
    expect(await markOf(ordenId, a.tecnicoId)).toBeNull();
    expect(await markOf(ordenId, b.tecnicoId)).toBeNull();
    await expect(mark(ordenId, a.userId)).resolves.toEqual({ status: "in_progress" });
    await expect(mark(ordenId, b.userId)).resolves.toEqual({ status: "ready_for_review" });
  });

  it("a technician not assigned to the order cannot mark, and a closed order refuses the assigned one", async () => {
    const a = await technician("closed-a");
    const stranger = await technician("closed-b");
    const open = await newOrder();
    await assign(open, a.tecnicoId);
    await expect(mark(open, stranger.userId)).rejects.toBeInstanceOf(ParteListaForbiddenError);
    expect(await markOf(open, a.tecnicoId)).toBeNull();

    const done = await newOrder("done");
    await assign(done, a.tecnicoId);
    await expect(mark(done, a.userId)).rejects.toBeInstanceOf(OrderClosedError);
    expect(await markOf(done, a.tecnicoId)).toBeNull();
  });
});
