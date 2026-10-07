/**
 * Real-SQL proof for customer-portal WU5a. The unit tests inject `withLock`,
 * so the snapshot SELECTs, the latest-consent read, the advisory lock and the
 * sequence never reach Postgres there. They do here, on a THROWAWAY database
 * (`dforce_e2e`). Only the HTTP send is replaced, at the network edge.
 */
import { execSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IngestBody } from "@portal/contract";
import { parseIngest } from "../../portal/src/ingest/parse";
import { recordConsent, rotatePortalToken } from "@/modules/customers/consent";
import { deactivateCliente, reactivateCliente, updateCliente } from "@/modules/customers/service";
import { enqueuePortalSync, ensurePortalSyncQueue } from "@/modules/portal-sync/enqueue";
import { runPortalSync } from "@/modules/portal-sync/job";
import { runPortalReconcile } from "@/modules/portal-sync/reconcile";
import { createOrder, transitionOrder, updateOrder } from "@/modules/service-orders/service";
import { SYSTEM_SCOPE } from "@/modules/service-orders/scope";
import { db } from "@/shared/db/client";
import { getBoss } from "@/shared/jobs/boss";
import { cliente, clienteConsentimiento, ordenServicio, users, vehiculo } from "@/shared/db/schema";
import { handleCreateVehiculo } from "../app/api/customers/[id]/vehicles/route";

const config = { url: "https://portal.example/api/ingest", secret: "e2e-secret" };
const T = (iso: string) => new Date(iso);

describe("portal-sync (E2E)", () => {
  const created: string[] = [];

  const newCliente = async (extra: Partial<typeof cliente.$inferInsert> = {}) => {
    const [row] = await db
      .insert(cliente)
      .values({ name: "SENTINEL_NAME", phone: "SENTINEL_PHONE", portalToken: `tok-${crypto.randomUUID()}`, ...extra })
      .returning();
    created.push(row.id);
    return row.id;
  };
  const consent = (clienteId: string, granted: boolean, recordedAt: string, id?: string) =>
    db.insert(clienteConsentimiento).values({ id, clienteId, granted, clauseVersion: "v", recordedAt: T(recordedAt) });

  /** Runs one sync and returns what would have been POSTed. */
  const run = async (id: string) => {
    const sent: IngestBody[] = [];
    await runPortalSync(id, { config, send: async (b) => void sent.push(b) });
    return sent;
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    if (created.length === 0) return;
    await db.delete(ordenServicio).where(inArray(ordenServicio.clienteId, created));
    await db.delete(cliente).where(inArray(cliente.id, created)); // vehicles and consent cascade
  });

  it("draws strictly increasing versions, as numbers, from the sequence", async () => {
    const raw = await db.execute(sql`SELECT nextval('portal_sync_version_seq') AS v`);
    expect(typeof (raw.rows[0] as { v: unknown }).v).toBe("string"); // the wire claim the Number() conversion rests on

    const id = await newCliente();
    await consent(id, true, "2026-01-01T00:00:00Z");
    const versions: number[] = [];
    for (let i = 0; i < 3; i++) {
      const [body] = await run(id);
      if (body.kind === "reconcile") throw new Error("unexpected reconcile");
      expect(typeof body.version).toBe("number");
      versions.push(body.version);
    }
    expect(versions[1]).toBeGreaterThan(versions[0]);
    expect(versions[2]).toBeGreaterThan(versions[1]);
  });

  it("decides by the NEWEST consent row by recorded_at, not by id", async () => {
    const id = await newCliente();
    // The newer row (revoked) has the SMALLER id, so ordering by id would pick the grant.
    await consent(id, true, "2026-01-01T00:00:00Z", "zzzz-older-grant");
    await consent(id, false, "2026-02-01T00:00:00Z", "aaaa-newer-revoke");
    expect((await run(id)).map((b) => b.kind)).toEqual(["delete"]);

    await consent(id, true, "2026-03-01T00:00:00Z", "mmmm-newest-grant");
    expect((await run(id)).map((b) => b.kind)).toEqual(["upsert"]);
  });

  it("pushes nothing for a customer who never consented, and a delete once deactivated", async () => {
    const never = await newCliente();
    expect(await run(never)).toEqual([]);

    const gone = await newCliente({ deactivatedAt: new Date() });
    await consent(gone, true, "2026-01-01T00:00:00Z");
    expect((await run(gone)).map((b) => b.kind)).toEqual(["delete"]);
  });

  it("reads only active vehicles and their orders, with no forbidden column on the wire", async () => {
    const id = await newCliente();
    await consent(id, true, "2026-01-01T00:00:00Z");
    const [live, dead] = await db
      .insert(vehiculo)
      .values([
        { clienteId: id, plate: "LIVE-1", make: "Toyota", chasis: "SENTINEL_CHASIS", colorPrimario: "SENTINEL_COLOR", placaMunicipio: "SENTINEL_MUNI" },
        { clienteId: id, plate: "DEAD-1", deactivatedAt: new Date() },
      ])
      .returning();
    const [liveOrder] = await db
      .insert(ordenServicio)
      .values([
        { clienteId: id, vehiculoId: live.id, categoria: "mant_preventivo", status: "ready_for_review", observaciones: "SENTINEL_OBS", hallazgos: "ok" },
        { clienteId: id, vehiculoId: dead.id, categoria: "reparacion", description: "DEAD_ORDER" },
      ])
      .returning();

    const [body] = await run(id);
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(/SENTINEL|DEAD_ORDER|DEAD-1|ready_for_review/);
    expect(parseIngest(JSON.parse(wire)).ok).toBe(true); // the real portal parser accepts it
    if (body.kind !== "upsert") throw new Error("expected upsert");
    expect(body.vehicles.map((v) => v.plate)).toEqual(["LIVE-1"]);
    expect(body.vehicles[0].orders).toEqual([
      expect.objectContaining({ id: liveOrder.id, status: "En proceso", categoria: "Mant. Preventivo", hallazgos: "ok" }),
    ]);
  });

  it("serializes two workers for one customer: the later version carries the later-read data", async () => {
    const id = await newCliente();
    await consent(id, true, "2026-01-01T00:00:00Z");
    const [veh] = await db.insert(vehiculo).values({ clienteId: id, plate: "LOCK-1" }).returning();
    const [ord] = await db
      .insert(ordenServicio)
      .values({ clienteId: id, vehiculoId: veh.id, categoria: "instalacion", hallazgos: "before" })
      .returning();

    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let aInSend!: () => void;
    const aReady = new Promise<void>((r) => (aInSend = r));
    const hallazgosOf = (b: IngestBody) => (b.kind === "upsert" ? b.vehicles[0].orders[0].hallazgos : null);
    const versionOf = (b: IngestBody) => (b.kind === "reconcile" ? -1 : b.version);
    const seen: { who: string; version: number; hallazgos: string | null }[] = [];

    const a = runPortalSync(id, {
      config,
      send: async (b) => {
        events.push("A:start");
        seen.push({ who: "A", version: versionOf(b), hallazgos: hallazgosOf(b) });
        aInSend();
        await gate;
        events.push("A:end");
      },
    });
    await aReady; // A has read, drawn its version and is inside the POST, holding the lock
    await db.update(ordenServicio).set({ hallazgos: "after" }).where(eq(ordenServicio.id, ord.id));
    const b = runPortalSync(id, {
      config,
      send: async (body) => {
        events.push("B:start");
        seen.push({ who: "B", version: versionOf(body), hallazgos: hallazgosOf(body) });
      },
    });
    await new Promise((r) => setTimeout(r, 300)); // B must still be waiting on the lock
    expect(events).toEqual(["A:start"]);
    release();
    await Promise.all([a, b]);

    expect(events).toEqual(["A:start", "A:end", "B:start"]);
    const [sa, sb] = seen;
    expect(sa).toMatchObject({ who: "A", hallazgos: "before" });
    expect(sb).toMatchObject({ who: "B", hallazgos: "after" });
    expect(sb.version).toBeGreaterThan(sa.version);
  });
});

/**
 * customer-portal WU5b — the triggers against real Postgres and a real pg-boss.
 * No worker runs in this process, so every enqueued job stays `created` and
 * `pgboss.job` is the whole observable.
 */
describe("portal-sync triggers (E2E)", () => {
  const ADMIN = "e2e-trigger-admin";
  const created: string[] = [];
  const enqueue = (id: string) => enqueuePortalSync(id, { config });
  const jobs = async (id: string, state?: string) => {
    const result = await db.execute(
      sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'portal-sync' AND data->>'clienteId' = ${id} AND (${state ?? null}::text IS NULL OR state::text = ${state ?? null})`,
    );
    return (result.rows[0] as { n: number }).n;
  };
  const clearJobs = (id: string) => db.execute(sql`DELETE FROM pgboss.job WHERE name = 'portal-sync' AND data->>'clienteId' = ${id}`);

  /** A consented customer with one active vehicle and one open order, jobs cleared. */
  const seed = async (extra: Partial<typeof cliente.$inferInsert> = {}) => {
    const [row] = await db
      .insert(cliente)
      .values({ name: "E2E Trigger", phone: `5076${Math.floor(Math.random() * 1e7)}`, portalToken: `tok-${crypto.randomUUID()}`, ...extra })
      .returning();
    created.push(row.id);
    await db.insert(clienteConsentimiento).values({ clienteId: row.id, granted: true, clauseVersion: "v" });
    const [veh] = await db.insert(vehiculo).values({ clienteId: row.id, plate: "TRG-1" }).returning();
    const [order] = await db.insert(ordenServicio).values({ clienteId: row.id, vehiculoId: veh.id, categoria: "revisado" }).returning();
    await clearJobs(row.id);
    return { id: row.id, vehicleId: veh.id, orderId: order.id };
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    await db.insert(users).values({ id: ADMIN, username: ADMIN, passwordHash: "x", role: "administrador" });
    await ensurePortalSyncQueue(await getBoss()); // starting pg-boss creates the `pgboss` schema the queries below read
  }, 60_000);

  afterAll(async () => {
    if (created.length > 0) {
      await db.execute(sql`DELETE FROM pgboss.job WHERE name = 'portal-sync' AND data->>'clienteId' IN (${sql.join(created.map((c) => sql`${c}`), sql`, `)})`);
      await db.delete(ordenServicio).where(inArray(ordenServicio.clienteId, created));
      await db.delete(cliente).where(inArray(cliente.id, created));
    }
    await db.delete(users).where(eq(users.id, ADMIN));
    await (await getBoss()).stop({ graceful: false });
  });

  it("enqueues exactly one job per trigger, each for the customer it changed", async () => {
    const c = await seed();
    const orderDeps = { enqueuePortalSync: enqueue, role: "administrador" as const, scope: SYSTEM_SCOPE };
    const triggers: [string, () => Promise<unknown>][] = [
      ["createOrder", () => createOrder({ clienteId: c.id, vehiculoId: c.vehicleId, categoria: "reparacion" }, { enqueuePortalSync: enqueue })],
      ["updateOrder", () => updateOrder(c.orderId, { hallazgos: "x" }, orderDeps)],
      ["transitionOrder", () => transitionOrder(c.orderId, "in_progress", { ...orderDeps, canAssign: true })],
      ["updateCliente (vehicle plan)", () => updateCliente(c.id, { vehicles: [{ id: c.vehicleId, plate: "TRG-1" }, { plate: "TRG-2" }] }, { enqueuePortalSync: enqueue })],
      [
        "createVehiculo route",
        () =>
          handleCreateVehiculo(
            new NextRequest("http://localhost/x", {
              method: "POST",
              headers: { "x-user-id": ADMIN, "x-user-role": "administrador", "content-type": "application/json" },
              body: JSON.stringify({ plate: "TRG-3" }),
            }),
            c.id,
            { enqueuePortalSync: enqueue },
          ),
      ],
      ["deactivateCliente", () => deactivateCliente(c.id, { enqueuePortalSync: enqueue })],
      ["reactivateCliente", () => reactivateCliente(c.id, { enqueuePortalSync: enqueue })],
      ["consent revoke", () => recordConsent(c.id, false, ADMIN, { enqueuePortalSync: enqueue })],
      ["consent grant", () => recordConsent(c.id, true, ADMIN, { enqueuePortalSync: enqueue })],
      ["rotate", () => rotatePortalToken(c.id, { enqueuePortalSync: enqueue })],
    ];
    for (const [name, fire] of triggers) {
      await clearJobs(c.id);
      await fire();
      expect(await jobs(c.id), name).toBe(1);
    }
  });

  it("a burst of edits queues ONE job, but an edit during a running job queues the next", async () => {
    const c = await seed();
    for (let i = 0; i < 3; i++) await updateOrder(c.orderId, { hallazgos: `v${i}` }, { enqueuePortalSync: enqueue, role: "administrador", scope: SYSTEM_SCOPE });
    expect(await jobs(c.id, "created")).toBe(1);

    await db.execute(sql`UPDATE pgboss.job SET state = 'active' WHERE name = 'portal-sync' AND data->>'clienteId' = ${c.id}`);
    await updateOrder(c.orderId, { hallazgos: "during" }, { enqueuePortalSync: enqueue, role: "administrador", scope: SYSTEM_SCOPE });
    expect(await jobs(c.id, "created")).toBe(1);
    expect(await jobs(c.id, "active")).toBe(1);
  });

  it("a rolled-back write enqueues nothing", async () => {
    const holder = await seed();
    const taken = (await db.select().from(cliente).where(eq(cliente.id, holder.id)))[0].portalToken!;
    const c = await seed({ portalToken: null });
    await db.delete(clienteConsentimiento).where(eq(clienteConsentimiento.clienteId, c.id));

    // The UNIQUE collision on the token rolls the consent row back with it.
    await expect(recordConsent(c.id, true, ADMIN, { generateToken: () => taken, enqueuePortalSync: enqueue })).rejects.toThrow();
    expect(await jobs(c.id)).toBe(0);
  });

  it("a repeat of the current consent state changes nothing and enqueues nothing", async () => {
    const c = await seed();
    await recordConsent(c.id, true, ADMIN, { enqueuePortalSync: enqueue });
    expect(await jobs(c.id)).toBe(0);
  });

  it("a customer who never consented still enqueues, but the worker pushes nothing", async () => {
    const [row] = await db.insert(cliente).values({ name: "E2E Never", phone: "50760000001" }).returning();
    created.push(row.id);
    await enqueue(row.id);
    expect(await jobs(row.id)).toBe(1);

    const sent: IngestBody[] = [];
    await runPortalSync(row.id, { config, send: async (b) => void sent.push(b) });
    expect(sent).toEqual([]);
  });
});

/** customer-portal WU5b — the reconcile's selection SQL, which only real Postgres can prove. */
describe("portal-reconcile (E2E)", () => {
  const created: string[] = [];
  const T = (iso: string) => new Date(iso);
  const make = async (extra: Partial<typeof cliente.$inferInsert> = {}) => {
    const [row] = await db
      .insert(cliente)
      .values({ name: "E2E Reconcile", phone: "50761112222", portalToken: `tok-${crypto.randomUUID()}`, ...extra })
      .returning();
    created.push(row.id);
    return row.id;
  };
  const consent = (clienteId: string, granted: boolean, at: string, id: string) =>
    db.insert(clienteConsentimiento).values({ id, clienteId, granted, clauseVersion: "v", recordedAt: T(at) });

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    if (created.length > 0) await db.delete(cliente).where(inArray(cliente.id, created));
  });

  it("sends the live set by the newest consent row, and enqueues everyone who ever consented", async () => {
    const live = await make();
    await consent(live, true, "2026-01-01T00:00:00Z", "live-1");

    // The newer row has the SMALLER id: ordering by id would get both of these backwards.
    const revoked = await make({ portalToken: null });
    await consent(revoked, true, "2026-01-01T00:00:00Z", "zzzz-rev-old-grant");
    await consent(revoked, false, "2026-02-01T00:00:00Z", "aaaa-rev-new-revoke");
    const regranted = await make();
    await consent(regranted, false, "2026-01-01T00:00:00Z", "zzzz-re-old-revoke");
    await consent(regranted, true, "2026-02-01T00:00:00Z", "aaaa-re-new-grant");

    // Token still set (a race or a manual fix can leave one): only the NEWEST row may decide, not "any grant ever".
    const revokedWithToken = await make();
    await consent(revokedWithToken, true, "2026-01-01T00:00:00Z", "rwt-grant");
    await consent(revokedWithToken, false, "2026-02-01T00:00:00Z", "rwt-revoke");
    // A lone revoke row still counts as "has ever had consent recorded", so its delete is repeated.
    const revokeOnly = await make({ portalToken: null });
    await consent(revokeOnly, false, "2026-01-01T00:00:00Z", "ro-revoke");

    const deactivated = await make({ deactivatedAt: new Date() });
    await consent(deactivated, true, "2026-01-01T00:00:00Z", "deact-1");
    const noToken = await make({ portalToken: null });
    await consent(noToken, true, "2026-01-01T00:00:00Z", "notoken-1");
    const never = await make();

    const before = Number((((await db.execute(sql`SELECT nextval('portal_sync_version_seq') AS v`)).rows[0]) as { v: string }).v);
    const enqueued: string[] = [];
    const sent: IngestBody[] = [];
    await runPortalReconcile({
      config,
      enqueue: async (id) => void enqueued.push(id),
      send: async (b) => void sent.push(b),
    });

    expect(sent).toHaveLength(1);
    const body = sent[0];
    if (body.kind !== "reconcile") throw new Error("expected reconcile");
    const mine = [live, revoked, regranted, revokedWithToken, revokeOnly, deactivated, noToken, never];
    expect(body.liveClienteIds.filter((id) => mine.includes(id)).sort()).toEqual([live, regranted].sort());
    expect(enqueued.filter((id) => mine.includes(id)).sort()).toEqual(
      [live, revoked, regranted, revokedWithToken, revokeOnly, deactivated, noToken].sort(),
    );
    expect(typeof body.maxVersion).toBe("number");
    expect(body.maxVersion).toBeGreaterThan(before);
    expect(parseIngest(JSON.parse(JSON.stringify(body))).ok).toBe(true); // the real portal parser accepts it
  });
});
