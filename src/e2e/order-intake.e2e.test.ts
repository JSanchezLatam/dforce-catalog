/**
 * Real-SQL proof for service-order-reception WU2 (vehicle intake). The unit
 * tests inject the db seam, so the three CHECK constraints, the columns' real
 * types and the PATCH `SET` that writes null never reach Postgres there. They
 * do here, against a THROWAWAY database (`dforce_e2e`, see README "Running the
 * E2E test") — never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, users, vehiculo } from "@/shared/db/schema";
import { PATCH } from "../app/api/service-orders/[id]/route";
import { POST } from "../app/api/service-orders/route";

describe("orden_servicio intake columns (E2E)", () => {
  let userId: string;
  let clienteId: string;
  let vehiculoId: string;
  const orderIds: string[] = [];

  const headers = () => ({ "x-user-id": userId, "x-user-role": "administrador", "Content-Type": "application/json" });
  const create = (body: Record<string, unknown>) =>
    POST(
      new NextRequest("http://localhost/api/service-orders", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ clienteId, vehiculoId, categoria: "revisado", ...body }),
      }),
    );
  const patch = (id: string, body: Record<string, unknown>) =>
    PATCH(new NextRequest(`http://localhost/api/service-orders/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  const stored = async (id: string) => (await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)))[0];
  const insertDirect = (values: Partial<typeof ordenServicio.$inferInsert>) =>
    db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado", ...values });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [user] = await db
      .insert(users)
      .values({ username: `e2e-intake-${Date.now()}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    userId = user.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Intake", phone: "50769992001" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db
      .insert(vehiculo)
      .values({ clienteId, plate: "INT001", motor: "hibrido" })
      .returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    if (orderIds.length) await db.delete(ordenServicio).where(inArray(ordenServicio.id, orderIds));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  });

  // Drizzle wraps the driver error; the constraint name is on the cause.
  async function violation(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
      expect(cause?.code).toBe("23514");
      return cause?.constraint ?? "";
    }
    throw new Error("expected a CHECK violation");
  }

  it("rejects out-of-range values on a direct insert, each by its own CHECK", async () => {
    expect(await violation(insertDirect({ nivelCombustible: 5 }))).toBe("orden_nivel_combustible_range");
    expect(await violation(insertDirect({ nivelCombustible: -1 }))).toBe("orden_nivel_combustible_range");
    expect(await violation(insertDirect({ bateriaPct: 101 }))).toBe("orden_bateria_pct_range");
    expect(await violation(insertDirect({ bateriaPct: -1 }))).toBe("orden_bateria_pct_range");
    expect(await violation(insertDirect({ kilometraje: -1 }))).toBe("orden_kilometraje_range");
    expect(await violation(insertDirect({ kilometraje: 2_000_001 }))).toBe("orden_kilometraje_range");
  });

  it("accepts the range edges on a direct insert", async () => {
    const rows = await insertDirect({ kilometraje: 2_000_000, nivelCombustible: 4, bateriaPct: 100 }).returning({
      id: ordenServicio.id,
    });
    orderIds.push(rows[0].id);
    await insertDirect({ kilometraje: 0, nivelCombustible: 0, bateriaPct: 0 });
  });

  it("round-trips intake through the create route, and stores null when none is sent", async () => {
    const full = await create({ kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 });
    expect(full.status).toBe(201);
    const fullId = (await full.json()).orden.id as string;
    orderIds.push(fullId);
    expect(await stored(fullId)).toMatchObject({ kilometraje: 85000, nivelCombustible: 2, bateriaPct: 100 });

    const bare = await create({});
    expect(bare.status).toBe(201);
    const bareId = (await bare.json()).orden.id as string;
    orderIds.push(bareId);
    expect(await stored(bareId)).toMatchObject({ kilometraje: null, nivelCombustible: null, bateriaPct: null });
  });

  it("create refuses a bad value with a 400 and inserts no row", async () => {
    const before = (await db.select().from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).length;
    const response = await create({ nivelCombustible: 5 });

    expect(response.status).toBe(400);
    const after = (await db.select().from(ordenServicio).where(eq(ordenServicio.clienteId, clienteId))).length;
    expect(after).toBe(before);
  });

  it("PATCH writes, leaves an omitted key alone, and clears to null", async () => {
    const res = await create({ kilometraje: 100, nivelCombustible: 1, bateriaPct: 50 });
    const id = (await res.json()).orden.id as string;
    orderIds.push(id);

    expect((await patch(id, { kilometraje: 200 })).status).toBe(200);
    expect(await stored(id)).toMatchObject({ kilometraje: 200, nivelCombustible: 1, bateriaPct: 50 });

    expect((await patch(id, { nivelCombustible: null, bateriaPct: 0 })).status).toBe(200);
    expect(await stored(id)).toMatchObject({ kilometraje: 200, nivelCombustible: null, bateriaPct: 0 });
  });

  it("PATCH refuses a bad value with a 400 and writes nothing", async () => {
    const res = await create({ kilometraje: 100 });
    const id = (await res.json()).orden.id as string;
    orderIds.push(id);

    const response = await patch(id, { kilometraje: -1 });
    expect(response.status).toBe(400);
    expect((await stored(id)).kilometraje).toBe(100);
  });
});
