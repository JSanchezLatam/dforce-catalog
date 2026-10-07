/**
 * Real-SQL proof for customer-portal WU5a. The unit tests inject `withLock`,
 * so the snapshot SELECTs, the latest-consent read, the advisory lock and the
 * sequence never reach Postgres there. They do here, on a THROWAWAY database
 * (`dforce_e2e`). Only the HTTP send is replaced, at the network edge.
 */
import { execSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IngestBody } from "@portal/contract";
import { parseIngest } from "../../portal/src/ingest/parse";
import { runPortalSync } from "@/modules/portal-sync/job";
import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento, ordenServicio, vehiculo } from "@/shared/db/schema";

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
