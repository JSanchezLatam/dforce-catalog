/**
 * Real-SQL proof for vehicle-details-and-renewals WU3. The unit tests inject
 * the query seam, so the candidate WHERE (active vehicle, active customer, at
 * least one renewal field), the composite-PK `ON CONFLICT DO NOTHING` and the
 * `contacted_by` SET NULL never run there. They run here against a THROWAWAY
 * Postgres (`DATABASE_URL`, see README "Running the E2E test"), never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, users, vehiculo, vehiculoContacto } from "@/shared/db/schema";
import { getDueVencimientos, markContactado } from "@/modules/vencimientos/service";
import { listContacts } from "@/modules/vencimientos/queries";
import { POST } from "../app/api/vencimientos/contact/route";
import { NextRequest } from "next/server";

const NOW = new Date("2026-10-04T15:00:00Z"); // 2026-10-04 in Panamá

describe("vencimientos due list and contact mark (E2E)", () => {
  const clienteIds: string[] = [];
  const userIds: string[] = [];
  const v: Record<string, string> = {};

  const mine = async () => {
    const { rows } = await getDueVencimientos(NOW);
    return rows.filter((r) => clienteIds.includes(r.clienteId));
  };
  const marks = (vehiculoId: string) =>
    db.select().from(vehiculoContacto).where(eq(vehiculoContacto.vehiculoId, vehiculoId));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const [active] = await db
      .insert(cliente)
      .values({ name: "E2E Venc Activo", phone: "50769990101", whatsappOptOut: true })
      .returning();
    const [inactive] = await db
      .insert(cliente)
      .values({ name: "E2E Venc Inactivo", phone: "50769990102", deactivatedAt: new Date() })
      .returning();
    clienteIds.push(active.id, inactive.id);

    const insertVehicle = async (key: string, clienteId: string, fields: Partial<typeof vehiculo.$inferInsert>) => {
      const [row] = await db.insert(vehiculo).values({ clienteId, plate: `E2E-${key}`, ...fields }).returning();
      v[key] = row.id;
    };
    await insertVehicle("placa", active.id, { make: "Toyota", model: "Corolla", numeroUnidad: "U-1", placaRenovacionMes: 10 });
    await insertVehicle("seguro", active.id, { seguroVence: "2026-09-01" });
    await insertVehicle("lejos", active.id, { seguroVence: "2026-11-04", placaRenovacionMes: 3 });
    await insertVehicle("sinCampos", active.id, {});
    await insertVehicle("desactivado", active.id, { placaRenovacionMes: 10, deactivatedAt: new Date() });
    await insertVehicle("clienteInactivo", inactive.id, { placaRenovacionMes: 10 });
  }, 60_000);

  // Deleting customers cascades to vehicles and their marks; users are removed by id.
  afterAll(async () => {
    if (clienteIds.length) await db.delete(cliente).where(inArray(cliente.id, clienteIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await db.$client.end();
  });

  it("lists only active vehicles of active customers whose renewal falls in the window", async () => {
    const rows = await mine();

    expect(rows.map((r) => [r.plate, r.kind, r.periodKey, r.state])).toEqual([
      ["E2E-seguro", "seguro", "2026-09-01", "overdue"],
      ["E2E-placa", "placa", "2026-10", "due"],
    ]);
    // The raw, server-only fields really come from cliente / vehiculo.
    expect(rows[1]).toMatchObject({
      customerName: "E2E Venc Activo",
      customerPhone: "50769990101",
      whatsappOptOut: true,
      make: "Toyota",
      model: "Corolla",
      numeroUnidad: "U-1",
    });
  });

  it("a double insert through the real route leaves exactly one mark, and the item drops out", async () => {
    // contacted_by FKs users, so the session user must be a real row.
    const [user] = await db.insert(users).values({ username: "e2e-venc-user", passwordHash: "x", role: "administrador" }).returning();
    userIds.push(user.id);

    const contact = (vehiculoId: string) =>
      POST(
        new NextRequest("http://localhost/api/vencimientos/contact", {
          method: "POST",
          headers: { "x-user-id": user.id, "x-user-role": "administrador", "Content-Type": "application/json" },
          body: JSON.stringify({ vehiculoId, kind: "placa", periodKey: "2026-10" }),
        }),
      );

    expect((await contact(v.placa)).status).toBe(200);
    expect((await contact(v.placa)).status).toBe(200);
    expect(await marks(v.placa)).toHaveLength(1);
    expect((await mine()).map((r) => r.plate)).toEqual(["E2E-seguro"]);
    expect((await contact("no-such-vehicle")).status).toBe(404);
  });

  it("a mark for one period does not hide the next, and another kind is unaffected", async () => {
    await markContactado({ vehiculoId: v.seguro, kind: "seguro", periodKey: "2026-09-01" }, null);
    expect((await mine()).map((r) => r.plate)).toEqual([]);

    // New expiry on the same vehicle: a fresh period, listed again.
    await db.update(vehiculo).set({ seguroVence: "2026-10-30" }).where(eq(vehiculo.id, v.seguro));
    expect((await mine()).map((r) => [r.plate, r.periodKey])).toEqual([["E2E-seguro", "2026-10-30"]]);
    // Next year's plate period is a different key than the one marked.
    const { rows } = await getDueVencimientos(new Date("2027-10-04T15:00:00Z"));
    expect(rows.filter((r) => r.vehiculoId === v.placa).map((r) => r.periodKey)).toEqual(["2027-10"]);
  });

  it("deleting the marking user sets contacted_by to NULL and keeps the mark", async () => {
    const [mark] = await marks(v.placa);
    expect(mark.contactedBy).toBe(userIds[0]);

    await db.delete(users).where(eq(users.id, userIds[0]));
    userIds.length = 0;

    const [after] = await marks(v.placa);
    expect(after.contactedBy).toBeNull();
    expect(await listContacts()).toEqual(expect.arrayContaining([{ vehiculoId: v.placa, kind: "placa", periodKey: "2026-10" }]));
  });

  it("deleting a vehicle cascades to its marks", async () => {
    await db.delete(vehiculo).where(eq(vehiculo.id, v.seguro));
    expect(await marks(v.seguro)).toHaveLength(0);
  });
});
