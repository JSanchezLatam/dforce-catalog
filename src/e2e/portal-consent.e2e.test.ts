/**
 * Real-SQL proof for customer-portal WU1 (Ley 81 consent record). The unit
 * tests inject the service seam, so the append, the latest-row read, the row
 * lock and the deactivated guard never reach Postgres there. They do here,
 * against a THROWAWAY database (`dforce_e2e`, see README "Running the E2E
 * test") — never the dev one.
 */
import { execSync } from "node:child_process";
import { asc, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONSENT_CLAUSE_VERSION, currentConsent, recordConsent } from "@/modules/customers/consent";
import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento, users } from "@/shared/db/schema";
import { POST } from "../app/api/customers/[id]/consent/route";

const ADMIN = "e2e-consent-admin";
const JEFE = "e2e-consent-jefe";

function post(id: string, body: unknown, userId = ADMIN, role = "administrador") {
  return POST(
    new NextRequest(`http://localhost/api/customers/${id}/consent`, {
      method: "POST",
      headers: { "x-user-id": userId, "x-user-role": role, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("cliente_consentimiento (E2E)", () => {
  const created: string[] = [];

  const newCliente = async (extra: Partial<typeof cliente.$inferInsert> = {}) => {
    const [row] = await db
      .insert(cliente)
      .values({ name: "E2E Consent", phone: "50769992001", ...extra })
      .returning();
    created.push(row.id);
    return row.id;
  };
  const rows = (id: string) =>
    db
      .select()
      .from(clienteConsentimiento)
      .where(eq(clienteConsentimiento.clienteId, id))
      .orderBy(asc(clienteConsentimiento.recordedAt));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    await db.insert(users).values([
      { id: ADMIN, username: ADMIN, passwordHash: "x", role: "administrador", name: "Ana Admin" },
      { id: JEFE, username: JEFE, passwordHash: "x", role: "jefe_taller" },
    ]);
  }, 60_000);

  afterAll(async () => {
    // Customers first: the consent rows cascade, and the users are then free to go.
    if (created.length) await db.delete(cliente).where(inArray(cliente.id, created));
    await db.delete(users).where(inArray(users.id, [ADMIN, JEFE]));
    await db.$client.end();
  });

  it("grant appends one granted row with who, when and the clause version", async () => {
    const id = await newCliente();
    const before = Date.now();
    const response = await post(id, { granted: true });

    expect(response.status).toBe(200);
    const stored = await rows(id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ granted: true, recordedBy: ADMIN, clauseVersion: CONSENT_CLAUSE_VERSION });
    expect(stored[0].recordedAt.getTime()).toBeGreaterThanOrEqual(before - 2_000);
  });

  it("revoke appends a revoked row and leaves the earlier row untouched; re-grant gives three rows in order", async () => {
    const id = await newCliente();
    await post(id, { granted: true });
    const [first] = await rows(id);
    await post(id, { granted: false }, JEFE, "jefe_taller");
    await post(id, { granted: true });

    const stored = await rows(id);
    expect(stored.map((r) => r.granted)).toEqual([true, false, true]);
    expect(stored[0]).toEqual(first);
    expect(stored[1].recordedBy).toBe(JEFE);
  });

  it("the current state is the LATEST row by recorded_at, even when ids sort the other way", async () => {
    const id = await newCliente();
    // The newer row (revoked) gets the SMALLER id; ordering by id would call this granted.
    await db.insert(clienteConsentimiento).values([
      { id: "zzz-older-granted", clienteId: id, granted: true, clauseVersion: "v", recordedAt: new Date("2026-01-01T10:00:00Z") },
      { id: "aaa-newer-revoked", clienteId: id, granted: false, clauseVersion: "v", recordedAt: new Date("2026-01-02T10:00:00Z") },
    ]);

    expect((await currentConsent(id))?.granted).toBe(false);
  });

  it("currentConsent carries the recording user's name, and is null with no row", async () => {
    const id = await newCliente();
    expect(await currentConsent(id)).toBeNull();

    await post(id, { granted: true });
    expect(await currentConsent(id)).toMatchObject({ granted: true, recordedByName: "Ana Admin" });

    await post(id, { granted: false }, JEFE, "jefe_taller");
    // No `name`: falls back to the username rather than showing nobody.
    expect(await currentConsent(id)).toMatchObject({ granted: false, recordedByName: JEFE });
  });

  it("repeating the state it already has appends nothing", async () => {
    const id = await newCliente();
    await post(id, { granted: true });
    const again = await post(id, { granted: true });

    expect(again.status).toBe(200);
    expect(await rows(id)).toHaveLength(1);

    // Revoking a customer who never consented records no refusal row either.
    const never = await newCliente({ phone: "50769992002" });
    expect((await post(never, { granted: false })).status).toBe(200);
    expect(await rows(never)).toHaveLength(0);
  });

  it("two concurrent grants append exactly one row", async () => {
    const id = await newCliente();
    await Promise.all([recordConsent(id, true, ADMIN), recordConsent(id, true, JEFE)]);

    expect(await rows(id)).toHaveLength(1);
  });

  // The test above can pass by timing alone. This one HOLDS the customer's row
  // lock from outside and shows the write waiting on it, which is the only
  // thing that fails when the FOR UPDATE is dropped. NO KEY UPDATE, not UPDATE:
  // the consent insert's foreign key takes FOR KEY SHARE on the customer, which
  // a plain FOR UPDATE blocks by itself, so that holder would make the test
  // pass with or without the lock under test.
  it("waits for the customer's row lock before reading or appending", async () => {
    const id = await newCliente();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));

    const holder = db.transaction(async (tx) => {
      await tx.select({ id: cliente.id }).from(cliente).where(eq(cliente.id, id)).for("no key update");
      locked();
      await held;
    });
    await lockTaken;

    let finished = false;
    const pending = recordConsent(id, true, ADMIN).then((r) => {
      finished = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(finished).toBe(false);
    expect(await rows(id)).toHaveLength(0);

    release();
    await holder;
    expect((await pending).changed).toBe(true);
    expect(await rows(id)).toHaveLength(1);
  });

  it("refuses a deactivated customer: 409 and no row", async () => {
    const id = await newCliente({ deactivatedAt: new Date() });
    const response = await post(id, { granted: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "cliente_deactivated" });
    expect(await rows(id)).toHaveLength(0);
  });

  it("answers 404 for an unknown customer and 403 for a tecnico, with no row either way", async () => {
    expect((await post("does-not-exist", { granted: true })).status).toBe(404);

    const id = await newCliente();
    expect((await post(id, { granted: true }, "someone", "tecnico")).status).toBe(403);
    expect(await rows(id)).toHaveLength(0);
  });

  it("deleting the recording user keeps the row (recorded_by set null)", async () => {
    const userId = "e2e-consent-temp";
    await db.insert(users).values({ id: userId, username: userId, passwordHash: "x", role: "jefe_taller" });
    const id = await newCliente();
    await recordConsent(id, true, userId);

    await db.delete(users).where(eq(users.id, userId));

    const stored = await rows(id);
    expect(stored).toHaveLength(1);
    expect(stored[0].recordedBy).toBeNull();
  });
});
