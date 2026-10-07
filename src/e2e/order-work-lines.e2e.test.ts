/**
 * Real-SQL proof for technicians-and-work-lines WU5: the composite FK, the
 * duration CHECK, the per-technician monthly SUM, the lock-scoped writes and the
 * correction audit sharing a transaction with the line are constraints, a
 * `WHERE` and a rollback, so only Postgres proves them. Run against a THROWAWAY
 * database (`dforce_e2e`) — never the dev one.
 */
import { execSync } from "node:child_process";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { cliente, ordenLineaTrabajo, ordenServicio, ordenServicioCorreccion, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { OrderClosedError } from "../modules/service-orders/order-lock";
import { orderScope, SYSTEM_SCOPE } from "../modules/service-orders/scope";
import { OrdenServicioNotFoundError } from "../modules/service-orders/service";
import {
  addWorkLine,
  deleteWorkLine,
  updateWorkLine,
  WorkLineForbiddenError,
  WorkLineValidationError,
  type WorkLineActor,
} from "../modules/service-orders/work-lines";

describe("order work lines (E2E)", () => {
  const stamp = Date.now();
  const madeUsers: string[] = [];
  let adminId: string;
  let userA: string; // login of roster A
  let userB: string;
  let rosterA: string;
  let rosterB: string;
  let rosterC: string; // never assigned to anything
  let clienteId: string;
  let vehiculoId: string;
  const staff = (): WorkLineActor => ({ id: adminId, canManageAll: true });
  const tecnicoActor = (id: string): WorkLineActor => ({ id, canManageAll: false });

  const insertUser = async (suffix: string, role: Role) => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-wl-${suffix}-${stamp}`, passwordHash: "x", role })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    return u.id;
  };
  const newOrder = async (status: typeof ordenServicio.$inferInsert.status = "in_progress", assign: string[] = [rosterA, rosterB]) => {
    const [o] = await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", status }).returning({ id: ordenServicio.id });
    for (const tecnicoId of assign) await db.insert(ordenTecnico).values({ ordenId: o.id, tecnicoId, assignedBy: adminId });
    return o.id;
  };
  const lines = (ordenId: string) => db.select().from(ordenLineaTrabajo).where(eq(ordenLineaTrabajo.ordenId, ordenId));
  const audit = (ordenId: string) =>
    db.select().from(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, ordenId)).orderBy(ordenServicioCorreccion.field, ordenServicioCorreccion.createdAt);
  const insertLine = (ordenId: string, tecnicoId: string, duracionMinutos: number, fecha: string) =>
    db.insert(ordenLineaTrabajo).values({ ordenId, tecnicoId, descripcion: "seed", duracionMinutos, fecha, createdBy: adminId });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    adminId = await insertUser("admin", "administrador");
    userA = await insertUser("a", "tecnico");
    userB = await insertUser("b", "tecnico");
    const roster = async (nombre: string, userId?: string) =>
      (await db.insert(tecnico).values({ nombre, userId }).returning({ id: tecnico.id }))[0].id;
    rosterA = await roster("WL A", userA);
    rosterB = await roster("WL B", userB);
    rosterC = await roster("WL C");
    const [c] = await db.insert(cliente).values({ name: "WL Cliente", phone: "50769994003" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "WL0001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = (await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).map((o) => o.id);
    if (orders.length) {
      await db.delete(ordenServicioCorreccion).where(inArray(ordenServicioCorreccion.ordenId, orders));
      await db.delete(ordenLineaTrabajo).where(inArray(ordenLineaTrabajo.ordenId, orders));
      await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    }
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [rosterA, rosterB, rosterC]));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  describe("constraints", () => {
    it("the composite FK rejects a line for a technician who is not assigned, even by a direct insert", async () => {
      const ordenId = await newOrder("in_progress", [rosterA]);
      await expect(insertLine(ordenId, rosterB, 30, "2026-10-05")).rejects.toThrow();
      expect(await lines(ordenId)).toEqual([]);
    });

    it.each([0, -5, 1441])("the CHECK rejects a direct insert of %i minutes", async (minutes) => {
      const ordenId = await newOrder();
      await expect(insertLine(ordenId, rosterA, minutes, "2026-10-05")).rejects.toThrow();
    });

    it("the service answers an unassigned technician in Spanish and stores nothing", async () => {
      const ordenId = await newOrder("in_progress", [rosterA]);
      await expect(
        addWorkLine({ ordenId, tecnicoId: rosterC, descripcion: "x", duracionMinutos: 10, actor: staff(), scope: SYSTEM_SCOPE }),
      ).rejects.toBeInstanceOf(WorkLineValidationError);
      expect(await lines(ordenId)).toEqual([]);
    });
  });

  it("SUM(duracion_minutos) for A in October excludes B and November", async () => {
    const ordenId = await newOrder();
    await insertLine(ordenId, rosterA, 30, "2026-10-01");
    await insertLine(ordenId, rosterA, 60, "2026-10-31");
    await insertLine(ordenId, rosterA, 500, "2026-11-01");
    await insertLine(ordenId, rosterB, 45, "2026-10-15");

    const [{ total }] = await db
      .select({ total: sql<number>`sum(${ordenLineaTrabajo.duracionMinutos})`.mapWith(Number) })
      .from(ordenLineaTrabajo)
      .where(
        and(eq(ordenLineaTrabajo.ordenId, ordenId), eq(ordenLineaTrabajo.tecnicoId, rosterA), gte(ordenLineaTrabajo.fecha, "2026-10-01"), lt(ordenLineaTrabajo.fecha, "2026-11-01")),
      );
    expect(total).toBe(90);
  });

  describe("writes under the order lock", () => {
    it("a técnico logs their own line, and an unassigned técnico gets no row (404) and writes nothing", async () => {
      const ordenId = await newOrder("in_progress", [rosterA]);

      const { id } = await addWorkLine({
        ordenId, tecnicoId: rosterA, descripcion: "  Cambio de pastillas ", duracionMinutos: 90, actor: tecnicoActor(userA), scope: orderScope({ id: userA, role: "tecnico" }),
      });
      const [row] = await lines(ordenId);
      expect(row).toMatchObject({ id, tecnicoId: rosterA, descripcion: "Cambio de pastillas", duracionMinutos: 90, createdBy: userA });
      expect(row.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await expect(
        addWorkLine({ ordenId, tecnicoId: rosterB, descripcion: "x", duracionMinutos: 10, actor: tecnicoActor(userB), scope: orderScope({ id: userB, role: "tecnico" }) }),
      ).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
      expect(await lines(ordenId)).toHaveLength(1);
    });

    it("a técnico cannot write for another technician, edit or delete their line", async () => {
      const ordenId = await newOrder();
      const [seed] = await insertLine(ordenId, rosterB, 30, "2026-10-05").returning({ id: ordenLineaTrabajo.id });
      const scope = orderScope({ id: userA, role: "tecnico" });

      await expect(
        addWorkLine({ ordenId, tecnicoId: rosterB, descripcion: "x", duracionMinutos: 10, actor: tecnicoActor(userA), scope }),
      ).rejects.toBeInstanceOf(WorkLineForbiddenError);
      await expect(
        updateWorkLine({ ordenId, lineId: seed.id, patch: { duracionMinutos: 99 }, actor: tecnicoActor(userA), scope }),
      ).rejects.toBeInstanceOf(WorkLineForbiddenError);
      await expect(deleteWorkLine({ ordenId, lineId: seed.id, actor: tecnicoActor(userA), scope })).rejects.toBeInstanceOf(
        WorkLineForbiddenError,
      );
      expect((await lines(ordenId))[0].duracionMinutos).toBe(30);
    });

    it("an edit cannot move a line to another technician or order", async () => {
      const ordenId = await newOrder();
      const otherOrder = await newOrder();
      const [seed] = await insertLine(ordenId, rosterA, 30, "2026-10-05").returning({ id: ordenLineaTrabajo.id });

      await updateWorkLine({
        ordenId, lineId: seed.id, patch: { duracionMinutos: 45, tecnicoId: rosterB, ordenId: otherOrder } as never, actor: staff(), scope: SYSTEM_SCOPE,
      });

      const [row] = await lines(ordenId);
      expect(row).toMatchObject({ tecnicoId: rosterA, ordenId, duracionMinutos: 45 });
      expect(await lines(otherOrder)).toEqual([]);
    });

    it("staff edit on ready_for_review leaves the order's status alone; open takes no line", async () => {
      const review = await newOrder("ready_for_review");
      const [seed] = await insertLine(review, rosterA, 30, "2026-10-05").returning({ id: ordenLineaTrabajo.id });
      await updateWorkLine({ ordenId: review, lineId: seed.id, patch: { duracionMinutos: 40 }, actor: staff(), scope: SYSTEM_SCOPE });
      expect((await lines(review))[0].duracionMinutos).toBe(40);
      expect((await db.select().from(ordenServicio).where(eq(ordenServicio.id, review)))[0].status).toBe("ready_for_review");

      const open = await newOrder("open");
      await expect(
        addWorkLine({ ordenId: open, tecnicoId: rosterA, descripcion: "x", duracionMinutos: 10, actor: staff(), scope: SYSTEM_SCOPE }),
      ).rejects.toThrow();
      expect(await lines(open)).toEqual([]);
    });

    it("a técnico who marked their part is refused until they un-mark", async () => {
      const ordenId = await newOrder();
      await db.update(ordenTecnico).set({ parteListaAt: new Date() }).where(and(eq(ordenTecnico.ordenId, ordenId), eq(ordenTecnico.tecnicoId, rosterA)));
      const input = { ordenId, tecnicoId: rosterA, descripcion: "x", duracionMinutos: 10, actor: tecnicoActor(userA), scope: SYSTEM_SCOPE };

      await expect(addWorkLine(input)).rejects.toThrow();
      expect(await lines(ordenId)).toEqual([]);
      await db.update(ordenTecnico).set({ parteListaAt: null }).where(eq(ordenTecnico.ordenId, ordenId));
      await expect(addWorkLine(input)).resolves.toHaveProperty("id");
    });
  });

  describe("corrections on a closed order", () => {
    const grant = () => ({ correctorId: adminId });

    it("without a grant a done order refuses every role and writes no line and no audit row", async () => {
      const ordenId = await newOrder("done");
      await expect(
        addWorkLine({ ordenId, tecnicoId: rosterA, descripcion: "x", duracionMinutos: 10, actor: staff(), scope: SYSTEM_SCOPE }),
      ).rejects.toBeInstanceOf(OrderClosedError);
      expect(await lines(ordenId)).toEqual([]);
      expect(await audit(ordenId)).toEqual([]);
    });

    it("add, edit and delete write exactly the audit rows the spec names", async () => {
      const ordenId = await newOrder("done");

      const { id } = await addWorkLine({
        ordenId, tecnicoId: rosterA, descripcion: "Alineación", duracionMinutos: 30, fecha: "2026-10-05", actor: staff(), scope: SYSTEM_SCOPE, correction: grant(),
      });
      await updateWorkLine({
        ordenId, lineId: id, patch: { duracionMinutos: 45, descripcion: "Alineación" }, actor: staff(), scope: SYSTEM_SCOPE, correction: grant(),
      });
      await deleteWorkLine({ ordenId, lineId: id, actor: staff(), scope: SYSTEM_SCOPE, correction: grant() });

      expect(await lines(ordenId)).toEqual([]);
      const rows = (await audit(ordenId)).map(({ userId, field, oldValue, newValue }) => ({ userId, field, oldValue, newValue }));
      expect(rows).toEqual([
        { userId: adminId, field: "linea_trabajo", oldValue: null, newValue: id },
        { userId: adminId, field: "linea_trabajo", oldValue: id, newValue: null },
        { userId: adminId, field: "linea_trabajo.duracion_minutos", oldValue: `${id}: 30`, newValue: `${id}: 45` },
      ]);
    });

    it("an open-order write with a grant writes no audit row", async () => {
      const ordenId = await newOrder();
      await addWorkLine({ ordenId, tecnicoId: rosterA, descripcion: "x", duracionMinutos: 10, actor: staff(), scope: SYSTEM_SCOPE, correction: grant() });
      expect(await audit(ordenId)).toEqual([]);
    });

    it("a throwing audit insert (corrector is not a user) leaves no line behind", async () => {
      const ordenId = await newOrder("done");
      await expect(
        addWorkLine({
          ordenId, tecnicoId: rosterA, descripcion: "x", duracionMinutos: 10, actor: staff(), scope: SYSTEM_SCOPE, correction: { correctorId: "no-such-user" },
        }),
      ).rejects.toThrow();
      expect(await lines(ordenId)).toEqual([]);
      expect(await audit(ordenId)).toEqual([]);
    });

    it("a throwing audit on delete keeps the line", async () => {
      const ordenId = await newOrder("done");
      const [seed] = await insertLine(ordenId, rosterA, 30, "2026-10-05").returning({ id: ordenLineaTrabajo.id });
      await expect(
        deleteWorkLine({ ordenId, lineId: seed.id, actor: staff(), scope: SYSTEM_SCOPE, correction: { correctorId: "no-such-user" } }),
      ).rejects.toThrow();
      expect(await lines(ordenId)).toHaveLength(1);
    });
  });
});
