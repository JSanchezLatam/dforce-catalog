/**
 * Real-SQL proof for service-order-workflow-states D10: an `appointment` reminder is sent only
 * while its order is still Agendada, judged from the database row when the job fires. The unit
 * suite injects the context loader, so neither the real reload of the order nor the `skipped`
 * write is exercised there. Run against a THROWAWAY database (`dforce_e2e`), never the dev one.
 */
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, reminder, users, vehiculo } from "@/shared/db/schema";
import { runReminder } from "../modules/reminders/job";
import { purgeHistory } from "./purge-history";

type Status = typeof ordenServicio.$inferInsert.status;

describe("appointment reminder fires only while the order is booked (E2E)", () => {
  const stamp = Date.now();
  let clienteId: string;
  let vehiculoId: string;
  let adminId: string;
  // Fixed instant well before the appointment, so the stale-timing guard cannot be what skips.
  const NOW = new Date("2031-01-01T12:00:00Z");
  const APPOINTMENT = new Date("2031-01-05T15:00:00Z");

  /** The order is inserted directly in `status`; the reminder row is what the job reloads. */
  async function seedReminder(status: Status, type: "appointment" | "service_due" = "appointment") {
    const [orden] = await db
      .insert(ordenServicio)
      .values({
        clienteId,
        vehiculoId,
        categoria: "revisado",
        status,
        appointmentAt: APPOINTMENT,
        esperaMotivo: status === "on_hold" ? "repuesto" : null,
      })
      .returning({ id: ordenServicio.id });
    const [row] = await db
      .insert(reminder)
      .values({ ordenId: orden.id, clienteId, type, channel: "email", scheduledFor: APPOINTMENT })
      .returning({ id: reminder.id });
    return row.id;
  }
  const statusOf = async (id: string) => (await db.select({ s: reminder.status }).from(reminder).where(eq(reminder.id, id)))[0].s;
  const fire = (id: string, sendViaChannel = vi.fn(async () => {})) => runReminder(id, { now: () => NOW, sendViaChannel }).then(() => sendViaChannel);

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-rg-${stamp}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    adminId = u.id;
    const [c] = await db.insert(cliente).values({ name: `Reminder Guard ${stamp}`, phone: "50769994301", email: "rg@example.com" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `RG${String(stamp).slice(-5)}` }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId)); // reminders cascade
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(eq(users.id, adminId));
    await db.$client.end();
  });

  it("Still booked sends", async () => {
    const id = await seedReminder("booked");
    const send = await fire(id);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await statusOf(id)).toBe("sent");
  });

  it.each(["open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"] as const)(
    "Received early is skipped: an order already %s sends nothing and the job completes",
    async (status) => {
      const id = await seedReminder(status);
      const send = await fire(id);

      expect(send).not.toHaveBeenCalled();
      expect(await statusOf(id)).toBe("skipped");
    },
  );

  it("Cancelled is skipped", async () => {
    const id = await seedReminder("cancelled");
    const send = await fire(id);

    expect(send).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe("skipped");
  });

  it("Other reminder types are unaffected: a service_due reminder on a received order still sends", async () => {
    const id = await seedReminder("open", "service_due");
    const send = await fire(id);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await statusOf(id)).toBe("sent");
  });

  it("Retry stays idempotent: a sent reminder is not sent twice", async () => {
    const id = await seedReminder("booked");
    await fire(id);
    const second = await fire(id);

    expect(second).not.toHaveBeenCalled();
  });
});
