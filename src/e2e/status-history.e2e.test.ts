/**
 * Real-SQL proof for service-order-workflow-states WU2: every status writer leaves
 * one `orden_estado_historial` row in the same transaction. The unit suites inject the
 * transaction, so neither the rows, the FK, nor the row lock that serializes concurrent
 * writers is exercised there. Run against a THROWAWAY database (`dforce_e2e`), never the dev one.
 */
import { execSync } from "node:child_process";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { assignTecnico } from "../modules/service-orders/assignments";
import { markParteLista, unmarkParteLista } from "../modules/service-orders/parte-lista";
import { listOrdenesServicio, getOrdenServicioById } from "../modules/service-orders/queries";
import { SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { createOrder, transitionOrder } from "../modules/service-orders/service";
import { setStatus } from "../modules/service-orders/set-status";
import { purgeHistory } from "./purge-history";

describe("order status history (E2E)", () => {
  const stamp = Date.now();
  const madeUsers: string[] = [];
  const madeRoster: string[] = [];
  let admin: string;
  let clienteId: string;
  let vehiculoId: string;

  const technician = async (suffix: string) => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-hist-${suffix}-${stamp}`, passwordHash: "x", role: "tecnico" })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    const [t] = await db.insert(tecnico).values({ nombre: `Hist ${suffix}`, userId: u.id }).returning({ id: tecnico.id });
    madeRoster.push(t.id);
    return { userId: u.id, tecnicoId: t.id };
  };
  const newOrder = async (status: typeof ordenServicio.$inferInsert.status) =>
    (await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status }).returning({ id: ordenServicio.id }))[0].id;
  const assignDirect = (ordenId: string, tecnicoId: string, parteListaAt: Date | null = null) =>
    db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: admin, parteListaAt });
  const assign = (ordenId: string, tecnicoId: string) => assignTecnico({ ordenId, tecnicoId, assignedBy: admin, scope: SYSTEM_SCOPE });
  const move = (ordenId: string, to: Parameters<typeof transitionOrder>[1], esperaMotivo?: "repuesto" | "aprobacion_cliente") =>
    transitionOrder(ordenId, to, {
      scope: SYSTEM_SCOPE,
      canAssign: true,
      actorId: admin,
      esperaMotivo,
      getClienteById: async () => null,
      cancelRemindersForOrder: async () => {},
      enqueuePortalSync: async () => {},
    });
  const create = (extra: Partial<Parameters<typeof createOrder>[0]> = {}) =>
    createOrder({ clienteId, vehiculoId, categoria: "revisado", createdBy: admin, ...extra }, { enqueuePortalSync: async () => {}, planReminders: () => [] });
  /** Oldest first, as the spec reads history. */
  const trail = async (ordenId: string) =>
    (await db.select().from(ordenEstadoHistorial).where(eq(ordenEstadoHistorial.ordenId, ordenId)).orderBy(asc(ordenEstadoHistorial.changedAt))).map(
      (r) => [r.fromStatus, r.toStatus, r.changedBy, r.esperaMotivo] as const,
    );
  const rowOf = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];

  /**
   * Runs the callers while another connection holds the order's FOR UPDATE, so they all reach the
   * lock together instead of one finishing before the next connects. Without a row lock they would
   * all read the same stale status; with it they queue and each sees the previous one's result.
   */
  const whileLocked = async (ordenId: string, ...callers: (() => Promise<unknown>)[]) => {
    let release!: () => void;
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.select().from(ordenServicio).where(eq(ordenServicio.id, ordenId)).for("update");
      locked();
      await gate;
    });
    await holding;
    const running = Promise.all(callers.map((call) => call()));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;
    await running;
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [a] = await db
      .insert(users)
      .values({ username: `e2e-hist-admin-${stamp}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    admin = a.id;
    madeUsers.push(admin);
    const [c] = await db.insert(cliente).values({ name: "Hist Cliente", phone: "50769994010" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "HST001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, madeRoster));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  describe("history per writer", () => {
    it("creation as booked writes one row: null -> booked, by the creator", async () => {
      const orden = await create({ status: "booked", appointmentAt: new Date("2026-12-01T15:00:00Z") });
      expect(await trail(orden.id)).toEqual([[null, "booked", admin, null]]);
    });

    it("a walk-in with a technician writes two rows, oldest first, and ends diagnosing", async () => {
      const t = await technician("walkin");
      const orden = await create({ tecnicoIds: [t.tecnicoId] });

      expect((await rowOf(orden.id)).status).toBe("diagnosing");
      expect(await trail(orden.id)).toEqual([
        [null, "open", admin, null],
        ["open", "diagnosing", admin, null],
      ]);
    });

    it("a manual transition writes one row", async () => {
      const ordenId = await newOrder("diagnosing");
      await move(ordenId, "in_progress");
      expect(await trail(ordenId)).toEqual([["diagnosing", "in_progress", admin, null]]);
    });

    it("readiness writes a row in both directions, attributed to the technician who marked", async () => {
      const t = await technician("ready");
      const ordenId = await newOrder("in_progress");
      await assignDirect(ordenId, t.tecnicoId);

      await markParteLista({ ordenId, userId: t.userId, scope: SYSTEM_SCOPE });
      await unmarkParteLista({ ordenId, userId: t.userId, scope: SYSTEM_SCOPE });

      expect(await trail(ordenId)).toEqual([
        ["in_progress", "ready_for_review", t.userId, null],
        ["ready_for_review", "in_progress", t.userId, null],
      ]);
    });

    it("assigning during review writes a ready_for_review -> in_progress row", async () => {
      const a = await technician("rev-a");
      const b = await technician("rev-b");
      const ordenId = await newOrder("ready_for_review");
      await assignDirect(ordenId, a.tecnicoId, new Date());

      await assign(ordenId, b.tecnicoId);

      expect(await trail(ordenId)).toEqual([["ready_for_review", "in_progress", admin, null]]);
    });

    it("the first assignment on an open order writes open -> diagnosing, by the assigner", async () => {
      const t = await technician("first");
      const ordenId = await newOrder("open");

      await assign(ordenId, t.tecnicoId);

      expect(await trail(ordenId)).toEqual([["open", "diagnosing", admin, null]]);
    });

    it("a bulk cancel of 3 orders writes exactly 3 -> cancelled rows", async () => {
      const ids = [await newOrder("open"), await newOrder("diagnosing"), await newOrder("in_progress")];
      for (const id of ids) await move(id, "cancelled");

      const rows = await db.select().from(ordenEstadoHistorial).where(inArray(ordenEstadoHistorial.ordenId, ids));
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.toStatus === "cancelled")).toBe(true);
    });

    it("booked -> open continues to diagnosing when a technician is assigned, writing both rows", async () => {
      const t = await technician("receive");
      const orden = await create({ status: "booked", appointmentAt: new Date("2026-12-01T15:00:00Z"), tecnicoIds: [t.tecnicoId] });
      expect(await trail(orden.id)).toEqual([[null, "booked", admin, null]]);

      await move(orden.id, "open");

      expect((await rowOf(orden.id)).status).toBe("diagnosing");
      expect(await trail(orden.id)).toEqual([
        [null, "booked", admin, null],
        ["booked", "open", admin, null],
        ["open", "diagnosing", admin, null],
      ]);
    });

    it("three changes come back oldest first", async () => {
      const t = await technician("order");
      const orden = await create({ tecnicoIds: [t.tecnicoId] });
      await move(orden.id, "in_progress");

      expect((await trail(orden.id)).map(([from, to]) => [from, to])).toEqual([
        [null, "open"],
        ["open", "diagnosing"],
        ["diagnosing", "in_progress"],
      ]);
    });
  });

  it("no change, no row: re-assigning, or assigning a second technician, to a diagnosing order", async () => {
    const t = await technician("nochange-a");
    const u = await technician("nochange-b");
    const ordenId = await newOrder("diagnosing");
    await assignDirect(ordenId, t.tecnicoId);

    expect(await assign(ordenId, t.tecnicoId)).toEqual({ created: false });
    expect(await assign(ordenId, u.tecnicoId)).toEqual({ created: true });

    expect(await trail(ordenId)).toEqual([]);
    expect((await rowOf(ordenId)).status).toBe("diagnosing");
  });

  it("assigning to a booked order keeps it booked and writes no row", async () => {
    const t = await technician("booked");
    const ordenId = await newOrder("booked");
    await assign(ordenId, t.tecnicoId);
    expect((await rowOf(ordenId)).status).toBe("booked");
    expect(await trail(ordenId)).toEqual([]);
  });

  it("a refused transition writes no row", async () => {
    const ordenId = await newOrder("open");
    await expect(move(ordenId, "in_progress")).rejects.toThrow();
    expect(await trail(ordenId)).toEqual([]);
  });

  it("status and row are atomic: a failing history insert leaves the status unchanged", async () => {
    const ordenId = await newOrder("diagnosing");

    // `changed_by` references users, so an unknown actor fails the INSERT after the UPDATE succeeded.
    await expect(
      db.transaction((tx) => setStatus(tx, { id: ordenId, status: "diagnosing" }, "in_progress", "no-such-user")),
    ).rejects.toThrow();

    expect((await rowOf(ordenId)).status).toBe("diagnosing");
    expect(await trail(ordenId)).toEqual([]);
  });

  it("concurrent first assignments transition once: both persist, exactly one open -> diagnosing row", async () => {
    const a = await technician("conc-a");
    const b = await technician("conc-b");
    const ordenId = await newOrder("open");

    await whileLocked(ordenId, () => assign(ordenId, a.tecnicoId), () => assign(ordenId, b.tecnicoId));

    expect(await db.select().from(ordenTecnico).where(eq(ordenTecnico.ordenId, ordenId))).toHaveLength(2);
    expect(await trail(ordenId)).toEqual([["open", "diagnosing", admin, null]]);
  });

  it("two simultaneous last marks write exactly one ready_for_review row", async () => {
    const a = await technician("marks-a");
    const b = await technician("marks-b");
    const ordenId = await newOrder("in_progress");
    await assignDirect(ordenId, a.tecnicoId);
    await assignDirect(ordenId, b.tecnicoId);

    await whileLocked(
      ordenId,
      () => markParteLista({ ordenId, userId: a.userId, scope: SYSTEM_SCOPE }),
      () => markParteLista({ ordenId, userId: b.userId, scope: SYSTEM_SCOPE }),
    );

    const rows = await trail(ordenId);
    expect(rows.filter(([, to]) => to === "ready_for_review")).toHaveLength(1);
    expect((await rowOf(ordenId)).status).toBe("ready_for_review");
  });

  it("the hold reason is stored and copied to history, then cleared on resume", async () => {
    const ordenId = await newOrder("in_progress");

    await move(ordenId, "on_hold", "repuesto");
    expect((await rowOf(ordenId)).esperaMotivo).toBe("repuesto");
    await move(ordenId, "in_progress");

    expect((await rowOf(ordenId)).esperaMotivo).toBeNull();
    expect(await trail(ordenId)).toEqual([
      ["in_progress", "on_hold", admin, "repuesto"],
      ["on_hold", "in_progress", admin, null],
    ]);
  });

  it("putting an order on hold and resuming it leaves every part-ready mark alone", async () => {
    const t = await technician("hold-mark");
    const ordenId = await newOrder("in_progress");
    const markedAt = new Date("2026-10-06T10:00:00Z");
    await assignDirect(ordenId, t.tecnicoId, markedAt);

    await move(ordenId, "on_hold", "aprobacion_cliente");
    await move(ordenId, "in_progress");

    const [assignment] = await db.select().from(ordenTecnico).where(eq(ordenTecnico.ordenId, ordenId));
    expect(assignment.parteListaAt?.toISOString()).toBe(markedAt.toISOString());
  });

  it("an order with history cannot be deleted directly", async () => {
    const ordenId = await newOrder("diagnosing");
    await move(ordenId, "in_progress");

    await expect(db.delete(ordenServicio).where(eq(ordenServicio.id, ordenId))).rejects.toThrow();
    expect(await rowOf(ordenId)).toBeDefined();
  });

  it("removing the acting user keeps the row, with a null actor", async () => {
    const [x] = await db
      .insert(users)
      .values({ username: `e2e-hist-gone-${stamp}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    const ordenId = await newOrder("diagnosing");
    await transitionOrder(ordenId, "in_progress", { scope: SYSTEM_SCOPE, canAssign: true, actorId: x.id, enqueuePortalSync: async () => {} });

    await db.delete(users).where(eq(users.id, x.id));

    expect(await trail(ordenId)).toEqual([["diagnosing", "in_progress", null, null]]);
  });

  it("an order created before the migration (zero rows) still reads in the list and the detail", async () => {
    const ordenId = await newOrder("in_progress");

    expect(await trail(ordenId)).toEqual([]);
    const listed = await listOrdenesServicio({}, { offset: 0, limit: 500 }, SYSTEM_SCOPE);
    expect(listed.map((o) => o.id)).toContain(ordenId);
    expect((await getOrdenServicioById(ordenId, SYSTEM_SCOPE))?.orden.id).toBe(ordenId);
  });
});
