/**
 * Real-SQL proof for workshop-agenda WU7: the quick-create customer flow through the real
 * `POST /api/customers` and `GET /api/customers`. The unit tests stub fetch, so the phone lookup
 * (`findClienteByPhone`), the unflagged insert and the status filter never reach Postgres there.
 * THROWAWAY `dforce_e2e` only.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cliente, users } from "@/shared/db/schema";
import { db } from "@/shared/db/client";
import { handleCreateCliente, handleListClientes } from "../app/api/customers/route";

const PHONE = "50769994001";
const PHONE_DEACTIVATED = "50769994002";
const PHONE_JEFE = "50769994003";

describe("agenda quick customer create (E2E)", () => {
  const userIds: Record<string, string> = {};
  const withPhone = (phone: string) => db.select().from(cliente).where(eq(cliente.phone, phone));
  const as = (role: "administrador" | "jefe_taller") => ({ "x-user-id": userIds[role], "x-user-role": role, "Content-Type": "application/json" });
  const create = (role: "administrador" | "jefe_taller", body: Record<string, unknown>) =>
    handleCreateCliente(new NextRequest("http://localhost/api/customers", { method: "POST", headers: as(role), body: JSON.stringify(body) }));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    for (const role of ["administrador", "jefe_taller"] as const) {
      const [u] = await db.insert(users).values({ username: `e2e-quick-${role}-${Date.now()}`, passwordHash: "x", role }).returning({ id: users.id });
      userIds[role] = u.id;
    }
  }, 60_000);

  afterAll(async () => {
    await db.delete(cliente).where(inArray(cliente.phone, [PHONE, PHONE_DEACTIVATED, PHONE_JEFE]));
    await db.delete(users).where(inArray(users.id, Object.values(userIds)));
    await db.$client.end();
  });

  it("Duplicate detection is real, Guardar igual works: 409 names the existing customer and inserts nothing; the flag creates a second customer and is not stored", async () => {
    const first = await create("administrador", { name: "Ana Quick", phone: PHONE });
    expect(first.status).toBe(201);
    const [existing] = await withPhone(PHONE);

    const refused = await create("administrador", { name: "Otra Ana", phone: PHONE });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "duplicate_phone", existingClienteId: existing.id });
    expect(await withPhone(PHONE)).toHaveLength(1);

    const forced = await create("administrador", { name: "Otra Ana", phone: PHONE, allowDuplicatePhone: true });
    expect(forced.status).toBe(201);
    const rows = await withPhone(PHONE);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !("allowDuplicatePhone" in r))).toBe(true);
  });

  it("jefe_taller creates too (201), the same as administrador", async () => {
    const res = await create("jefe_taller", { name: "Jefe Quick", phone: PHONE_JEFE });
    expect(res.status).toBe(201);
    expect(await withPhone(PHONE_JEFE)).toHaveLength(1);
  });

  it("Deactivated duplicate cannot be reused: the phone still 409s, Guardar igual still creates (201), the default lookup hides the match and status=all shows it deactivated", async () => {
    const [old] = await db.insert(cliente).values({ name: "Vieja Desactivada", phone: PHONE_DEACTIVATED, deactivatedAt: new Date() }).returning();

    const refused = await create("administrador", { name: "Nueva", phone: PHONE_DEACTIVATED });
    expect(refused.status).toBe(409);
    expect((await refused.json()).existingClienteId).toBe(old.id);

    const lookup = async (query: string) =>
      (await handleListClientes(new NextRequest(`http://localhost/api/customers?search=${PHONE_DEACTIVATED}&pageSize=50${query}`, { headers: as("administrador") }))).json();
    expect((await lookup("")).customers.map((c: { id: string }) => c.id)).not.toContain(old.id);
    const all = (await lookup("&status=all")).customers.find((c: { id: string }) => c.id === old.id);
    expect(all.deactivatedAt).not.toBeNull();

    const forced = await create("administrador", { name: "Nueva", phone: PHONE_DEACTIVATED, allowDuplicatePhone: true });
    expect(forced.status).toBe(201);
    expect(await withPhone(PHONE_DEACTIVATED)).toHaveLength(2);
  });
});
