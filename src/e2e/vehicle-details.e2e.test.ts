/**
 * Real-SQL proof for vehicle-details-and-renewals WU1. The unit tests inject
 * the db seam, so the dynamic SET that omits the internal columns, the `date`
 * string round trip and the CHECK constraint never run there. They run here
 * against a real Postgres (`DATABASE_URL`, see README "Running the E2E test"):
 * a THROWAWAY database, never the dev one.
 *
 * The routes are called with no injected deps, so this is the real service,
 * the real transaction and the real `applyVehiculoPlan`.
 */
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getClienteById } from "@/modules/customers/queries";
import { db } from "@/shared/db/client";
import { cliente, vehiculo } from "@/shared/db/schema";
import { PATCH } from "../app/api/customers/[id]/route";
import { POST } from "../app/api/customers/route";

const admin = { "x-user-id": "e2e-vd-admin", "x-user-role": "administrador" };
const tecnico = { "x-user-id": "e2e-vd-tecnico", "x-user-role": "tecnico" };

function json(method: string, url: string, headers: Record<string, string>, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("vehicle details and internal fields (E2E)", () => {
  let clienteId: string;
  let vehiculoId: string;

  const patch = (headers: Record<string, string>, vehicle: Record<string, unknown>) =>
    PATCH(
      json("PATCH", `http://localhost/api/customers/${clienteId}`, headers, {
        vehicles: [{ id: vehiculoId, plate: "VD-001", ...vehicle }],
      }),
      { params: Promise.resolve({ id: clienteId }) },
    );

  const stored = async () => {
    const [row] = await db.select().from(vehiculo).where(eq(vehiculo.id, vehiculoId));
    return row;
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });

    const response = await POST(
      json("POST", "http://localhost/api/customers", admin, {
        name: "E2E Vehicle Details",
        phone: "50769990001",
        vehicles: [
          {
            plate: "VD-001",
            colorPrimario: "Rojo",
            estilo: "SUV",
            motor: "hibrido",
            placaRenovacionMes: 3,
            seguroVence: "2026-11-15",
          },
        ],
      }),
    );
    expect(response.status).toBe(201);
    clienteId = (await response.json()).cliente.id;
    vehiculoId = (await getClienteById(clienteId))!.vehicles[0].id;
  }, 60_000);

  // Deleting by captured id cascades to the vehicle.
  afterAll(async () => {
    if (clienteId) await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.$client.end();
  });

  it("round-trips the descriptive fields, and seguro_vence comes back as the same string", async () => {
    const row = await stored();
    expect(row).toMatchObject({ colorPrimario: "Rojo", estilo: "SUV", motor: "hibrido", placaRenovacionMes: 3 });
    expect(row.seguroVence).toBe("2026-11-15");
    expect(typeof row.seguroVence).toBe("string");
  });

  it("a tecnico edit without the internal keys keeps the stored values", async () => {
    const response = await patch(tecnico, { colorPrimario: "Azul", estilo: "SUV", motor: "hibrido" });
    expect(response.status).toBe(200);

    const row = await stored();
    expect(row.colorPrimario).toBe("Azul");
    expect(row.placaRenovacionMes).toBe(3);
    expect(row.seguroVence).toBe("2026-11-15");
  });

  it("a tecnico sending either key, null included, gets 403 and nothing changes", async () => {
    for (const vehicle of [{ placaRenovacionMes: null }, { seguroVence: null }, { placaRenovacionMes: 9 }]) {
      expect((await patch(tecnico, { colorPrimario: "Verde", ...vehicle })).status).toBe(403);
    }
    const row = await stored();
    expect(row.colorPrimario).toBe("Azul");
    expect(row.placaRenovacionMes).toBe(3);
    expect(row.seguroVence).toBe("2026-11-15");
  });

  it("an administrador omitting the keys keeps them, a value sets, and null clears each independently", async () => {
    expect((await patch(admin, { colorPrimario: "Negro" })).status).toBe(200);
    expect(await stored()).toMatchObject({ placaRenovacionMes: 3, seguroVence: "2026-11-15" });

    expect((await patch(admin, { placaRenovacionMes: 7 })).status).toBe(200);
    expect(await stored()).toMatchObject({ placaRenovacionMes: 7, seguroVence: "2026-11-15" });

    expect((await patch(admin, { seguroVence: null })).status).toBe(200);
    expect(await stored()).toMatchObject({ placaRenovacionMes: 7, seguroVence: null });

    expect((await patch(admin, { placaRenovacionMes: null })).status).toBe(200);
    expect(await stored()).toMatchObject({ placaRenovacionMes: null, seguroVence: null });
  });

  it("the CHECK constraint rejects a renewal month of 13 and accepts 12", async () => {
    const write = (month: number) => db.update(vehiculo).set({ placaRenovacionMes: month }).where(eq(vehiculo.id, vehiculoId));

    await expect(write(13)).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(write(0)).rejects.toMatchObject({ cause: { code: "23514" } });
    await write(12);
    expect((await stored()).placaRenovacionMes).toBe(12);
  });
});
