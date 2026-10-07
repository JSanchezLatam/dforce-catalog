/**
 * Real-SQL proof for closed-order-lock WU1. The unit tests inject the
 * transaction, so they prove nothing about Postgres: not migration 0027, not the
 * `restrict` FKs, not `FOR UPDATE`, not the audit insert. They do here, against a
 * THROWAWAY database (`dforce_e2e`, see README "Running the E2E test") — never
 * the dev one.
 */
import { execSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenServicioCorreccion, users, vehiculo } from "@/shared/db/schema";
import {
  lockOrderForMutation,
  OrderClosedError,
  recordCorrections,
} from "../modules/service-orders/order-lock";
import { transitionOrder } from "../modules/service-orders/service";
import { OrderTransitionError } from "../modules/service-orders/transitions";

describe("orden_servicio_correccion (E2E)", () => {
  let userId: string;
  let clienteId: string;
  let vehiculoId: string;
  let otherUserId: string | undefined;

  const newOrder = async (status: "open" | "in_progress" | "done") => {
    const [row] = await db
      .insert(ordenServicio)
      .values({ clienteId, vehiculoId, categoria: "revisado", status })
      .returning({ id: ordenServicio.id });
    return row.id;
  };
  const auditRows = (ordenId: string) =>
    db.select().from(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, ordenId));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [user] = await db
      .insert(users)
      .values({ username: `e2e-lock-${Date.now()}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    userId = user.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Lock", phone: "50769993002" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "LOK001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    const orders = await db.select({ id: ordenServicio.id }).from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    for (const { id } of orders) await db.delete(ordenServicioCorreccion).where(eq(ordenServicioCorreccion.ordenId, id));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(eq(users.id, userId));
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    await db.$client.end();
  });

  it("both foreign keys are ON DELETE restrict", async () => {
    const { rows } = await db.execute(sql`
      select a.attname as col, c.confdeltype as rule
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'orden_servicio_correccion'::regclass and c.contype = 'f'
      order by a.attname`);
    expect(rows).toEqual([
      { col: "orden_id", rule: "r" },
      { col: "user_id", rule: "r" },
    ]);
  });

  it("an order with audit rows cannot be deleted", async () => {
    const ordenId = await newOrder("done");
    await db.insert(ordenServicioCorreccion).values({ ordenId, userId, field: "hallazgos", oldValue: null, newValue: "x" });
    await expect(db.delete(ordenServicio).where(eq(ordenServicio.id, ordenId))).rejects.toThrow();
    expect(await auditRows(ordenId)).toHaveLength(1);
  });

  it("a user with audit rows cannot be deleted", async () => {
    const [other] = await db
      .insert(users)
      .values({ username: `e2e-lock-other-${Date.now()}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    otherUserId = other.id;
    const ordenId = await newOrder("done");
    await db.insert(ordenServicioCorreccion).values({ ordenId, userId: other.id, field: "hallazgos", oldValue: null, newValue: "x" });
    await expect(db.delete(users).where(eq(users.id, other.id))).rejects.toThrow();
  });

  it("locks a real row: an open order passes, a closed one needs the grant, a missing grant refuses", async () => {
    const openId = await newOrder("open");
    const doneId = await newOrder("done");
    await db.transaction(async (tx) => {
      const open = await lockOrderForMutation(tx, openId, { canWrite: (s) => s === "open" });
      expect(open.correcting).toBe(false);
    });
    await db.transaction(async (tx) => {
      const done = await lockOrderForMutation(tx, doneId, { canWrite: () => false, correction: { correctorId: userId } });
      expect(done).toMatchObject({ correcting: true, order: { id: doneId, status: "done" } });
    });
    await expect(
      db.transaction((tx) => lockOrderForMutation(tx, doneId, { canWrite: () => false })),
    ).rejects.toBeInstanceOf(OrderClosedError);
  });

  it("FOR UPDATE makes a second locker wait for the first transaction", async () => {
    const ordenId = await newOrder("open");
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = db.transaction(async (tx) => {
      await lockOrderForMutation(tx, ordenId, { canWrite: () => true });
      order.push("first locked");
      await held;
      order.push("first committing");
    });
    await new Promise((r) => setTimeout(r, 100));
    const second = db.transaction(async (tx) => {
      await lockOrderForMutation(tx, ordenId, { canWrite: () => true });
      order.push("second locked");
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(order).toEqual(["first locked"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "first committing", "second locked"]);
  });

  it("recordCorrections writes exactly the changed fields, encoded as text", async () => {
    const ordenId = await newOrder("done");
    await db.transaction((tx) =>
      recordCorrections(tx, {
        ordenId,
        userId,
        before: { hallazgos: null, kilometraje: 100, appointmentAt: null, description: "same" },
        after: { hallazgos: "nuevo", kilometraje: 250, appointmentAt: new Date("2026-10-06T12:00:00.000Z"), description: "same" },
      }),
    );
    const rows = (await auditRows(ordenId)).map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue }));
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { field: "hallazgos", oldValue: null, newValue: "nuevo" },
        { field: "kilometraje", oldValue: "100", newValue: "250" },
        { field: "appointmentAt", oldValue: null, newValue: "2026-10-06T12:00:00.000Z" },
      ]),
    );
  });

  it("a concurrent done and cancelled on one order cannot both win: the loser finds it closed", async () => {
    const ordenId = await newOrder("in_progress");
    // The reminder side effects are not under test (they are no-ops here); the status write is.
    const deps = { getClienteById: async () => null, cancelRemindersForOrder: async () => {} };
    const results = await Promise.allSettled([
      transitionOrder(ordenId, "done", deps),
      transitionOrder(ordenId, "cancelled", deps),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(OrderTransitionError);
    const [row] = await db.select().from(ordenServicio).where(eq(ordenServicio.id, ordenId));
    expect(row.status).toBe((won[0] as PromiseFulfilledResult<{ status: string }>).value.status);
  });
});
