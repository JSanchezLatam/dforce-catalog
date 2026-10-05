/**
 * Real-SQL proof for service-order-reception WU1 (Cédula / RUC). The unit
 * tests inject the db seam, so the column itself, the absence of a unique
 * index, the PATCH `SET` that writes null, and the import's UPDATE never
 * reach Postgres there. They do here, against a THROWAWAY database
 * (`dforce_e2e`, see README "Running the E2E test") — never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCustomerImport } from "@/modules/customer-import/job";
import { db } from "@/shared/db/client";
import { cliente } from "@/shared/db/schema";
import { PATCH } from "../app/api/customers/[id]/route";
import { POST } from "../app/api/customers/route";

const admin = { "x-user-id": "e2e-doc-admin", "x-user-role": "administrador" };

function json(method: string, url: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { ...admin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("cliente.documento_identidad (E2E)", () => {
  const created: string[] = [];

  const create = async (body: Record<string, unknown>) => {
    const response = await POST(json("POST", "http://localhost/api/customers", { allowDuplicatePhone: true, ...body }));
    expect(response.status).toBe(201);
    const id = (await response.json()).cliente.id as string;
    created.push(id);
    return id;
  };
  const patch = (id: string, body: Record<string, unknown>) =>
    PATCH(json("PATCH", `http://localhost/api/customers/${id}`, body), { params: Promise.resolve({ id }) });
  const stored = async (id: string) => (await db.select().from(cliente).where(eq(cliente.id, id)))[0];

  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    if (created.length) await db.delete(cliente).where(inArray(cliente.id, created));
    await db.$client.end();
  });

  it("round-trips a trimmed value on create, and stores null when none is sent", async () => {
    const withDoc = await create({ name: "E2E Doc A", phone: "50769991001", documentoIdentidad: "  8-123-456  " });
    const without = await create({ name: "E2E Doc B", phone: "50769991002" });

    expect((await stored(withDoc)).documentoIdentidad).toBe("8-123-456");
    expect((await stored(without)).documentoIdentidad).toBeNull();
  });

  it("accepts the same value on two customers (no unique index at any level)", async () => {
    const a = await create({ name: "E2E Doc C", phone: "50769991003", documentoIdentidad: "8-777-888" });
    const b = await create({ name: "E2E Doc D", phone: "50769991004", documentoIdentidad: "8-777-888" });

    expect((await stored(a)).documentoIdentidad).toBe("8-777-888");
    expect((await stored(b)).documentoIdentidad).toBe("8-777-888");
  });

  it("PATCH trims, leaves the column alone when omitted, and clears to null on null or blank", async () => {
    const id = await create({ name: "E2E Doc E", phone: "50769991005", documentoIdentidad: "8-1-1" });

    expect((await patch(id, { documentoIdentidad: "  9-2-2  " })).status).toBe(200);
    expect((await stored(id)).documentoIdentidad).toBe("9-2-2");

    expect((await patch(id, { name: "E2E Doc E2" })).status).toBe(200);
    expect((await stored(id)).documentoIdentidad).toBe("9-2-2");

    expect((await patch(id, { documentoIdentidad: null })).status).toBe(200);
    expect((await stored(id)).documentoIdentidad).toBeNull();

    expect((await patch(id, { documentoIdentidad: "5-5-5" })).status).toBe(200);
    expect((await patch(id, { documentoIdentidad: "   " })).status).toBe(200);
    expect((await stored(id)).documentoIdentidad).toBeNull();
  });

  it("PATCH rejects 31 characters with a 400 and writes nothing", async () => {
    const id = await create({ name: "E2E Doc F", phone: "50769991006", documentoIdentidad: "8-1-1" });

    const response = await patch(id, { documentoIdentidad: "a".repeat(31) });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.documentoIdentidad).toBe("La cédula / RUC no puede superar 30 caracteres");
    expect((await stored(id)).documentoIdentidad).toBe("8-1-1");
  });

  it("PATCH rejects a non-string with a 400 and leaves the stored value alone", async () => {
    const id = await create({ name: "E2E Doc G", phone: "50769991007", documentoIdentidad: "8-1-1" });

    const response = await patch(id, { documentoIdentidad: 12345678 });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.documentoIdentidad).toBe("La cédula / RUC tiene que ser texto");
    expect((await stored(id)).documentoIdentidad).toBe("8-1-1");
  });

  it("a customer-import UPDATE leaves documento_identidad unchanged", async () => {
    const externalId = `e2e-doc-${Date.now()}`;
    const [row] = await db
      .insert(cliente)
      .values({ name: "E2E Imported", phone: "6111-0000", externalId, documentoIdentidad: "8-123-456" })
      .returning();
    created.push(row.id);

    async function* fetchCustomers() {
      yield [{ Cliente: externalId, Nombre: "E2E Imported Renamed", Telefono_1: "6222-0000" }];
    }
    const result = await runCustomerImport({ fetchCustomers });

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(await stored(row.id)).toMatchObject({ name: "E2E Imported Renamed", documentoIdentidad: "8-123-456" });
  });
});
