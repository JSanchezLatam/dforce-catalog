/**
 * Real-SQL proof for workshop-agenda WU8: Reprogramar and "No se presentó" through the real PATCH
 * route, and the `expectedStatus` guard on the real `FOR UPDATE` lock path (a stub lock would test
 * the stub). THROWAWAY `dforce_e2e` only. The pg-boss seams are the stubbed ones (no queue in e2e);
 * the reminder and history ROWS are real.
 */
import { execSync } from "node:child_process";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, reminder, users, vehiculo } from "@/shared/db/schema";
import { handleCreateOrdenServicio } from "../app/api/service-orders/route";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { purgeHistory } from "./purge-history";

const NOW = new Date("2031-03-10T14:00:00Z");
const STALE = { error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." };

describe("agenda actions (E2E)", () => {
  let userId: string;
  let clienteId: string;
  let vehiculoId: string;
  const deps = { now: () => NOW, scheduleReminder: vi.fn(async () => "job-1"), enqueuePortalSync: vi.fn(async () => {}), getBoss: async () => ({ deleteJob: vi.fn() }) } as never;

  const patch = (id: string, body: unknown) =>
    handleUpdateOrdenServicio(
      new NextRequest(`http://localhost/api/service-orders/${id}`, {
        method: "PATCH",
        headers: { "x-user-id": userId, "x-user-role": "administrador", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      id,
      deps,
    );
  const book = async (appointmentAt: string) => {
    const res = await handleCreateOrdenServicio(
      new NextRequest("http://localhost/api/service-orders", {
        method: "POST",
        headers: { "x-user-id": userId, "x-user-role": "administrador", "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, status: "booked", appointmentAt, description: "Cambio de aceite" }),
      }),
      deps,
    );
    expect(res.status).toBe(201);
    return (await res.json()).orden.id as string;
  };
  const rowOf = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];
  const trail = async (id: string) =>
    (await db.select().from(ordenEstadoHistorial).where(eq(ordenEstadoHistorial.ordenId, id)).orderBy(asc(ordenEstadoHistorial.changedAt))).map((h) => [h.fromStatus, h.toStatus]);
  const reminders = (id: string, status: "scheduled" | "cancelled") =>
    db.select().from(reminder).where(and(eq(reminder.ordenId, id), eq(reminder.type, "appointment"), eq(reminder.status, status)));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-actions-${Date.now()}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    userId = u.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Actions", phone: "50769993002" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `E8${Date.now()}`.slice(0, 10), motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.id, vehiculoId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(inArray(users.id, [userId]));
    await db.$client.end();
  });

  it("Reschedule persists and replans the reminder: the new instant, the old appointment reminder cancelled, a new one scheduled", async () => {
    const id = await book("2031-03-20T09:00:00-05:00");
    expect(await reminders(id, "scheduled")).not.toHaveLength(0);

    const res = await patch(id, { appointmentAt: "2031-03-25T15:30:00-05:00" });

    expect(res.status).toBe(200);
    expect((await rowOf(id)).appointmentAt?.toISOString()).toBe("2031-03-25T20:30:00.000Z");
    expect(await reminders(id, "cancelled")).not.toHaveLength(0);
    const fresh = await reminders(id, "scheduled");
    expect(fresh).not.toHaveLength(0);
    expect(fresh.every((r) => r.scheduledFor.getTime() < new Date("2031-03-25T20:30:00Z").getTime())).toBe(true);
  });

  it("Cancels as an ordinary cancellation: cancelled, pending reminders cancelled, exactly one booked -> cancelled row", async () => {
    const id = await book("2031-03-21T09:00:00-05:00");

    const res = await patch(id, { status: "cancelled", expectedStatus: "booked" });

    expect(res.status).toBe(200);
    expect((await rowOf(id)).status).toBe("cancelled");
    expect(await reminders(id, "scheduled")).toHaveLength(0);
    expect(await reminders(id, "cancelled")).not.toHaveLength(0);
    expect(await trail(id)).toEqual([[null, "booked"], ["booked", "cancelled"]]);
  });

  it("Stale no-show is refused: received meanwhile, the guarded cancel answers 409 with the exact message, the order stays open and nothing is written", async () => {
    const id = await book("2031-03-22T09:00:00-05:00");
    expect((await patch(id, { vehiculoId, categoria: "revisado" })).status).toBe(200);
    expect((await patch(id, { status: "open" })).status).toBe(200);
    const before = await trail(id);
    const pendingBefore = await reminders(id, "scheduled");

    const res = await patch(id, { status: "cancelled", expectedStatus: "booked" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(STALE);
    expect((await rowOf(id)).status).toBe("open");
    expect(await trail(id)).toEqual(before);
    expect(await reminders(id, "scheduled")).toHaveLength(pendingBefore.length);
  });

  it("Transitions without expectedStatus are unchanged: the same cancel without the guard still cancels an open order", async () => {
    const id = await book("2031-03-23T09:00:00-05:00");
    await patch(id, { vehiculoId, categoria: "revisado" });
    await patch(id, { status: "open" });

    const res = await patch(id, { status: "cancelled" });

    expect(res.status).toBe(200);
    expect((await rowOf(id)).status).toBe("cancelled");
    expect((await trail(id)).at(-1)).toEqual(["open", "cancelled"]);
  });
});
