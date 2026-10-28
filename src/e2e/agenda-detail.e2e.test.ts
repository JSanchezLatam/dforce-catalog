/**
 * Real-SQL proof for agenda-redesign WU11: the Detail's type chip is `PATCH { categoria, expectedStatus: "booked" }`.
 * It must persist, and it must be refused (409 stale_status, `categoria` untouched) for an order received elsewhere:
 * the guard sits on the real `FOR UPDATE` lock path. THROWAWAY `dforce_e2e` only.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, users, vehiculo } from "@/shared/db/schema";
import { handleCreateOrdenServicio } from "../app/api/service-orders/route";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { purgeHistory } from "./purge-history";

const NOW = new Date("2031-04-10T14:00:00Z");
const STALE = { error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." };

describe("agenda detail edits (E2E)", () => {
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

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [u] = await db.insert(users).values({ username: `e2e-detail-${Date.now()}`, passwordHash: "x", role: "administrador" }).returning({ id: users.id });
    userId = u.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Detail", phone: "50769993003" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `E11${Date.now()}`.slice(0, 10), motor: "combustion" }).returning({ id: vehiculo.id });
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

  it("Edit the type persists: the chip PATCH on a booked order stores the new categoria", async () => {
    const id = await book("2031-04-20T09:00:00-05:00");
    expect((await patch(id, { vehiculoId, categoria: "revisado" })).status).toBe(200);

    const res = await patch(id, { categoria: "reparacion", expectedStatus: "booked" });

    expect(res.status).toBe(200);
    expect((await rowOf(id)).categoria).toBe("reparacion");
  });

  it("Stale type edit: received elsewhere, the chip PATCH answers 409 stale_status and categoria is unchanged", async () => {
    const id = await book("2031-04-21T09:00:00-05:00");
    expect((await patch(id, { vehiculoId, categoria: "revisado" })).status).toBe(200);
    expect((await patch(id, { status: "open" })).status).toBe(200);

    const res = await patch(id, { categoria: "reparacion", expectedStatus: "booked" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(STALE);
    const row = await rowOf(id);
    expect(row.categoria).toBe("revisado");
    expect(row.status).toBe("open");
  });
});
