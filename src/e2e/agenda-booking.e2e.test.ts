/**
 * Real-SQL proof for workshop-agenda WU6: the booking dialog's exact POST body through the real
 * create route. The unit tests stub fetch, so the booked-without-vehicle CHECK, the history row and
 * the reminder plan never reach Postgres there. THROWAWAY `dforce_e2e` only. The pg-boss enqueue is
 * the one stubbed seam (no queue in e2e); the reminder ROW is real.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { rangeFor } from "@/modules/agenda/dates";
import { toAgendaItem } from "@/modules/agenda/items";
import { agendaRange } from "@/modules/agenda/queries";
import { SYSTEM_SCOPE } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { cliente, ordenEstadoHistorial, ordenServicio, reminder, users } from "@/shared/db/schema";
import { handleCreateOrdenServicio } from "../app/api/service-orders/route";
import { purgeHistory } from "./purge-history";

const NOW = new Date("2031-03-10T14:00:00Z");

describe("agenda booking (E2E)", () => {
  let userId: string;
  let clienteId: string;
  const book = (appointmentAt: string) =>
    handleCreateOrdenServicio(
      new NextRequest("http://localhost/api/service-orders", {
        method: "POST",
        headers: { "x-user-id": userId, "x-user-role": "administrador", "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, status: "booked", appointmentAt, description: "Cambio de aceite" }),
      }),
      { now: () => NOW, scheduleReminder: vi.fn(async () => "job-1"), enqueuePortalSync: vi.fn(async () => {}) } as never,
    );
  const created = async (res: Response) => {
    expect(res.status).toBe(201);
    return (await res.json()).orden.id as string;
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-booking-${Date.now()}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    userId = u.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Booking", phone: "50769993001" }).returning({ id: cliente.id });
    clienteId = c.id;
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(inArray(users.id, [userId]));
    await db.$client.end();
  });

  it("Persists as booked without vehicle: null vehicle and category, the chosen instant, one null -> booked row, a reminder 10 days ahead, none 11 h ahead; the order reads back as Sin vehículo", async () => {
    const far = await created(await book("2031-03-20T09:00:00-05:00"));
    const near = await created(await book("2031-03-10T20:00:00-05:00"));

    const [row] = await db.select().from(ordenServicio).where(eq(ordenServicio.id, far));
    expect(row).toMatchObject({ status: "booked", vehiculoId: null, categoria: null });
    expect(row.appointmentAt?.toISOString()).toBe("2031-03-20T14:00:00.000Z");

    const history = await db.select().from(ordenEstadoHistorial).where(eq(ordenEstadoHistorial.ordenId, far));
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, "booked"]]);

    expect((await db.select().from(reminder).where(eq(reminder.ordenId, far))).length).toBeGreaterThan(0);
    expect(await db.select().from(reminder).where(eq(reminder.ordenId, near))).toHaveLength(0);

    const { rows } = await agendaRange(SYSTEM_SCOPE, rangeFor("day", "2031-03-20"));
    const mine = rows.find((r) => r.id === far)!;
    expect(toAgendaItem(mine, NOW)).toMatchObject({ vehicleLabel: "Sin vehículo", dayKey: "2031-03-20", time: "09:00" });
  });
});
