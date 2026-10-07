/**
 * Real SQL, throwaway database (`dforce_portal_test`, never `dforce_portal`):
 *   DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_portal_test npm run test:e2e
 * Goes through the real route handler: signature, skew, shape and SQL together.
 */
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "../app/api/ingest/route";
import { sign, type IngestBody, type PortalVehicle } from "../src/contract";
import { db } from "../src/db/client";
import { portalCustomer } from "../src/db/schema";

const SECRET = "e2e-secret";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const vehicles = (plate: string): PortalVehicle[] => [
  {
    id: "v1",
    plate,
    make: "Toyota",
    model: null,
    year: 2015,
    orders: [
      {
        id: "o1",
        status: "Terminada",
        categoria: "Mecánica",
        createdAt: "2026-10-01T10:00:00.000Z",
        appointmentAt: null,
        completedAt: "2026-10-02T10:00:00.000Z",
        description: null,
        hallazgos: null,
        recomendaciones: null,
      },
    ],
  },
];
const upsert = (version: number, plate = "AB1234", tokenHash = HASH_A, clienteId = "c1"): IngestBody => ({
  kind: "upsert",
  clienteId,
  version,
  tokenHash,
  generatedAt: "2026-10-01T10:00:00.000Z",
  vehicles: vehicles(plate),
});

/** A request signed the way the workshop will sign it. */
const post = (body: unknown, opts: { now?: number; secret?: string; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  return POST(
    new Request("http://portal.test/api/ingest", {
      method: "POST",
      body: raw,
      headers: sign(raw, opts.secret ?? SECRET, opts.now),
    }),
  );
};
const row = async (id = "c1") =>
  (await db.select().from(portalCustomer).where(eq(portalCustomer.clienteId, id)))[0];

beforeAll(async () => {
  process.env.PORTAL_INGEST_SECRET = SECRET;
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../src/db/migrations") });
});
beforeEach(async () => {
  await db.delete(portalCustomer);
});
afterAll(async () => {
  await db.delete(portalCustomer);
});

describe("ingest e2e", () => {
  it("version 6 over 5 replaces the snapshot", async () => {
    await post(upsert(5, "OLD111"));
    const res = await post(upsert(6, "NEW222"));
    expect(await res.json()).toEqual({ applied: true });
    const r = await row();
    expect(r.version).toBe(6);
    expect(r.snapshot?.vehicles[0].plate).toBe("NEW222");
  });

  it("5 over 6 changes nothing and still answers 200", async () => {
    await post(upsert(6, "NEW222"));
    const res = await post(upsert(5, "OLD111"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: false });
    const r = await row();
    expect(r.version).toBe(6);
    expect(r.snapshot?.vehicles[0].plate).toBe("NEW222");
  });

  it("an equal version is a no-op, and replaying the same signed body too", async () => {
    await post(upsert(6, "FIRST1"));
    const res = await post(upsert(6, "OTHER2"));
    expect(await res.json()).toEqual({ applied: false });
    expect((await row()).snapshot?.vehicles[0].plate).toBe("FIRST1");

    const raw = JSON.stringify(upsert(7, "REPLAY"));
    const headers = sign(raw, SECRET);
    const send = () => POST(new Request("http://portal.test/api/ingest", { method: "POST", body: raw, headers }));
    expect(await (await send()).json()).toEqual({ applied: true });
    expect(await (await send()).json()).toEqual({ applied: false });
  });

  it("delete writes a data-free tombstone and keeps the version", async () => {
    await post(upsert(5));
    const res = await post({ kind: "delete", clienteId: "c1", version: 7 });
    expect(await res.json()).toEqual({ applied: true });
    const r = await row();
    expect(r.tokenHash).toBeNull();
    expect(r.snapshot).toBeNull();
    expect(r.version).toBe(7);
  });

  it("a delayed upsert v6 after delete v7 stores nothing", async () => {
    await post({ kind: "delete", clienteId: "c1", version: 7 });
    const res = await post(upsert(6));
    expect(await res.json()).toEqual({ applied: false });
    const r = await row();
    expect(r.tokenHash).toBeNull();
    expect(r.snapshot).toBeNull();
    expect(r.version).toBe(7);
  });

  it("deleting an unknown customer succeeds and leaves a tombstone", async () => {
    const res = await post({ kind: "delete", clienteId: "ghost", version: 3 });
    expect(res.status).toBe(200);
    const r = await row("ghost");
    expect(r.tokenHash).toBeNull();
    expect(r.version).toBe(3);
  });

  it("rotation swaps the hash, so the old hash resolves nothing", async () => {
    await post(upsert(5, "AB1234", HASH_A));
    await post(upsert(6, "AB1234", HASH_B));
    const all = await db.select().from(portalCustomer);
    expect(all.map((r) => r.tokenHash)).toEqual([HASH_B]);
    expect(await db.select().from(portalCustomer).where(eq(portalCustomer.tokenHash, HASH_A))).toEqual([]);
  });

  it("reconcile deletes only rows NOT live AND older than maxVersion", async () => {
    await post(upsert(5, "LIVE11", "1".repeat(64), "live"));
    await post(upsert(5, "GONE11", "2".repeat(64), "gone-old"));
    await post(upsert(20, "NEWER1", "3".repeat(64), "gone-newer"));
    await post({ kind: "delete", clienteId: "tomb", version: 4 });
    const res = await post({ kind: "reconcile", liveClienteIds: ["live"], maxVersion: 10 });
    expect(res.status).toBe(200);
    const ids = (await db.select().from(portalCustomer)).map((r) => r.clienteId).sort();
    expect(ids).toEqual(["gone-newer", "live"]);
  });

  it("reconcile with an empty live set purges every older row", async () => {
    await post(upsert(5));
    const res = await post({ kind: "reconcile", liveClienteIds: [], maxVersion: 10 });
    expect(res.status).toBe(200);
    expect(await db.select().from(portalCustomer)).toEqual([]);
  });

  it("stores no plaintext token anywhere: only what was sent as the hash", async () => {
    await post(upsert(5));
    const r = await row();
    expect(JSON.stringify(r)).not.toMatch(/plaintext/i);
    expect(r.tokenHash).toBe(HASH_A);
  });

  it("bad signature, skew and tampering write nothing", async () => {
    expect((await post(upsert(5), { secret: "other" })).status).toBe(401);
    expect((await post(upsert(5), { now: Math.floor(Date.now() / 1000) - 360 })).status).toBe(401);
    const raw = JSON.stringify(upsert(5));
    const headers = sign(raw, SECRET);
    const tampered = await POST(
      new Request("http://portal.test/api/ingest", { method: "POST", body: raw.replace("AB1234", "ZZ9999"), headers }),
    );
    expect(tampered.status).toBe(401);
    expect(await db.select().from(portalCustomer)).toEqual([]);
  });

  it("an unexpected key is refused with 400 and nothing is stored", async () => {
    const bad = { ...upsert(5), phone: "555-0100" };
    expect((await post(bad)).status).toBe(400);
    expect(await db.select().from(portalCustomer)).toEqual([]);
  });

  it("two concurrent newer versions end with the highest, in either arrival order", async () => {
    for (let i = 0; i < 25; i++) {
      await db.delete(portalCustomer);
      await post(upsert(1));
      const [lo, hi] = [upsert(2, "LOW222"), upsert(3, "HIGH33")];
      await Promise.all(i % 2 ? [post(lo), post(hi)] : [post(hi), post(lo)]);
      const r = await row();
      expect(r.version, `round ${i}`).toBe(3);
      expect(r.snapshot?.vehicles[0].plate).toBe("HIGH33");
    }
  });
});
