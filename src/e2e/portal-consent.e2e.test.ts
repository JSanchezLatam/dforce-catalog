/**
 * Real-SQL proof for customer-portal WU1 (Ley 81 consent record). The unit
 * tests inject the service seam, so the append, the latest-row read, the row
 * lock and the deactivated guard never reach Postgres there. They do here,
 * against a THROWAWAY database (`dforce_e2e`, see README "Running the E2E
 * test") — never the dev one.
 */
import { execSync } from "node:child_process";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONSENT_CLAUSE_VERSION, currentConsent, recordConsent, rotatePortalToken } from "@/modules/customers/consent";
import { listClientes } from "@/modules/customers/queries";
import { deactivateCliente, reactivateCliente } from "@/modules/customers/service";
import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento, users } from "@/shared/db/schema";
import { POST } from "../app/api/customers/[id]/consent/route";
import { POST as ROTATE } from "../app/api/customers/[id]/portal-token/rotate/route";

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

describe("cliente.portal_token (E2E, customer-portal WU2)", () => {
  const created: string[] = [];
  const ADMIN2 = "e2e-token-admin";

  const newCliente = async (extra: Partial<typeof cliente.$inferInsert> = {}) => {
    const [row] = await db
      .insert(cliente)
      .values({ name: "E2E Token", phone: "50769993001", ...extra })
      .returning();
    created.push(row.id);
    return row.id;
  };
  const tokenOf = async (id: string) =>
    (await db.select({ t: cliente.portalToken }).from(cliente).where(eq(cliente.id, id)))[0].t;
  const consentRows = (id: string) =>
    db.select().from(clienteConsentimiento).where(eq(clienteConsentimiento.clienteId, id));
  const rotate = (id: string, body: unknown, role = "administrador") =>
    ROTATE(
      new NextRequest(`http://localhost/api/customers/${id}/portal-token/rotate`, {
        method: "POST",
        headers: { "x-user-id": ADMIN2, "x-user-role": role, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  beforeAll(async () => {
    await db.insert(users).values({ id: ADMIN2, username: ADMIN2, passwordHash: "x", role: "administrador" });
  });

  afterAll(async () => {
    if (created.length) await db.delete(cliente).where(inArray(cliente.id, created));
    await db.delete(users).where(eq(users.id, ADMIN2));
  });

  it("a grant stores a 256-bit base64url token with the consent row", async () => {
    const id = await newCliente();
    await recordConsent(id, true, ADMIN2);

    expect(await tokenOf(id)).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(await consentRows(id)).toHaveLength(1);
  });

  it("grant and token are ONE transaction: a failure on the token write leaves no consent row either", async () => {
    const holder = await newCliente({ phone: "50769993002" });
    await recordConsent(holder, true, ADMIN2);
    const taken = (await tokenOf(holder))!;

    const id = await newCliente({ phone: "50769993003" });
    // The consent row is inserted BEFORE the token write, so a UNIQUE violation
    // there can only roll the row back if both share one transaction.
    await expect(recordConsent(id, true, ADMIN2, { generateToken: () => taken })).rejects.toThrow();

    expect(await consentRows(id)).toHaveLength(0);
    expect(await tokenOf(id)).toBeNull();
  });

  it("a revoke nulls the token, and a re-grant mints a NEW one", async () => {
    const id = await newCliente({ phone: "50769993004" });
    await recordConsent(id, true, ADMIN2);
    const first = await tokenOf(id);

    await recordConsent(id, false, ADMIN2);
    expect(await tokenOf(id)).toBeNull();

    await recordConsent(id, true, ADMIN2);
    const second = await tokenOf(id);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(second).not.toBe(first);
  });

  it("repeating a grant keeps the same token", async () => {
    const id = await newCliente({ phone: "50769993005" });
    await recordConsent(id, true, ADMIN2);
    const first = await tokenOf(id);
    await recordConsent(id, true, ADMIN2);

    expect(await tokenOf(id)).toBe(first);
  });

  it("portal_token is UNIQUE", async () => {
    const a = await newCliente({ phone: "50769993006" });
    const b = await newCliente({ phone: "50769993007" });
    await db.update(cliente).set({ portalToken: "dup-token" }).where(eq(cliente.id, a));

    await expect(db.update(cliente).set({ portalToken: "dup-token" }).where(eq(cliente.id, b))).rejects.toThrow();
  });

  it("rotate replaces the token and the old value exists nowhere in cliente", async () => {
    const id = await newCliente({ phone: "50769993008" });
    await recordConsent(id, true, ADMIN2);
    const old = (await tokenOf(id))!;

    const response = await rotate(id, { confirm: true });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(old);
    const now = (await tokenOf(id))!;
    expect(now).not.toBe(old);
    expect(now).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const rows = await db.execute(
      sql`select count(*)::int as n from cliente c where c::text like ${"%" + old + "%"}`,
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("rotate without the confirmation flag changes nothing", async () => {
    const id = await newCliente({ phone: "50769993009" });
    await recordConsent(id, true, ADMIN2);
    const before = await tokenOf(id);

    expect((await rotate(id, {})).status).toBe(400);
    expect((await rotate(id, { confirm: "true" })).status).toBe(400);
    expect(await tokenOf(id)).toBe(before);
  });

  it("rotate is refused for jefe_taller with 403, and for a customer without current consent with 409", async () => {
    const id = await newCliente({ phone: "50769993010" });
    await recordConsent(id, true, ADMIN2);
    const before = await tokenOf(id);
    expect((await rotate(id, { confirm: true }, "jefe_taller")).status).toBe(403);
    expect(await tokenOf(id)).toBe(before);

    const none = await newCliente({ phone: "50769993011" });
    expect((await rotate(none, { confirm: true })).status).toBe(409);
    expect(await tokenOf(none)).toBeNull();

    await recordConsent(id, false, ADMIN2);
    expect((await rotate(id, { confirm: true })).status).toBe(409);
    expect(await tokenOf(id)).toBeNull();
  });

  it("rotate answers 404 for an unknown customer and 409 for a deactivated one", async () => {
    expect((await rotate("does-not-exist", { confirm: true })).status).toBe(404);

    const id = await newCliente({ phone: "50769993012" });
    await recordConsent(id, true, ADMIN2);
    await deactivateCliente(id);
    expect((await rotate(id, { confirm: true })).status).toBe(409);
  });

  it("deactivating and reactivating keeps the consent rows and the token", async () => {
    const id = await newCliente({ phone: "50769993013" });
    await recordConsent(id, true, ADMIN2);
    const token = await tokenOf(id);

    await deactivateCliente(id);
    expect(await tokenOf(id)).toBe(token);
    expect(await consentRows(id)).toHaveLength(1);

    await reactivateCliente(id);
    expect(await tokenOf(id)).toBe(token);
    expect((await currentConsent(id))?.granted).toBe(true);
  });

  it("the customer list carries no token field, against the real select", async () => {
    const id = await newCliente({ name: "E2E Token List", phone: "50769993014" });
    await recordConsent(id, true, ADMIN2);

    const rows = await listClientes({ search: "E2E Token List" }, { offset: 0, limit: 10 });

    expect(rows.map((r) => r.id)).toContain(id);
    for (const row of rows) {
      expect(row).not.toHaveProperty("portalToken");
      expect(JSON.stringify(row)).not.toContain((await tokenOf(id))!);
    }
  });

  it("rotatePortalToken itself refuses when the latest consent row is a revoke", async () => {
    const id = await newCliente({ phone: "50769993015" });
    await recordConsent(id, true, ADMIN2);
    await recordConsent(id, false, ADMIN2);

    await expect(rotatePortalToken(id)).rejects.toThrow();
  });
});

// File scope, after every describe: the pool is shared and ending it inside one
// describe's `afterAll` kills every describe that runs after it.
afterAll(async () => {
  await db.$client.end();
});
