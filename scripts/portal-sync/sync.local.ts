/**
 * Workshop sync job -> portal handlers -> customer API, end to end (customer-portal WU7).
 * Run it through `npm run test:portal-sync`, which creates the two throwaway
 * databases and passes their URLs in.
 *
 * Real: both Postgres databases, the workshop services, `runPortalSync` /
 * `runPortalReconcile`, the real signer in `sendToPortal`, and the portal's own
 * route handlers (ingest, open, accept, snapshot) with their real HMAC check,
 * parser, version gate and SQL.
 *
 * Not real, on purpose: the socket. `fetch` is replaced by a function that
 * hands the signed `Request` straight to the ingest handler. Spawning
 * `next dev` would add a port to find, a process to supervise and a
 * boot-time race, and would test Next, not our code; the handler is the same
 * function either way. "Portal offline" is that function throwing, which is
 * what an unreachable host looks like to `fetch`. Also not real: the pg-boss
 * queue (a spy collects the ids a trigger enqueues and `drain()` plays the
 * worker; enqueue and retry settings are covered in `src/e2e/portal-sync.e2e.test.ts`).
 *
 * Two databases, one process: both DB clients read `DATABASE_URL` when their
 * module loads, so the env var is switched between the two dynamic imports.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workshopUrl = process.env.PORTAL_SYNC_WORKSHOP_URL;
const portalUrl = process.env.PORTAL_SYNC_PORTAL_URL;
if (!workshopUrl || !portalUrl || /\/dforce_(catalog|portal)$/.test(workshopUrl + portalUrl)) {
  throw new Error("test:portal-sync must be run through `npm run test:portal-sync` (it owns the throwaway databases)");
}

const SECRET = "portal-sync-local-secret";
const config = { url: "http://localhost/api/ingest", secret: SECRET };
const ADMIN = "portal-sync-local-admin";

async function load() {
  process.env.DATABASE_URL = workshopUrl;
  const workshop = {
    db: (await import("@/shared/db/client")).db,
    schema: await import("@/shared/db/schema"),
    consent: await import("@/modules/customers/consent"),
    customers: await import("@/modules/customers/service"),
    orders: await import("@/modules/service-orders/service"),
    scope: await import("@/modules/service-orders/scope"),
    job: await import("@/modules/portal-sync/job"),
    reconcile: await import("@/modules/portal-sync/reconcile"),
    transport: await import("@/modules/portal-sync/transport"),
  };
  process.env.DATABASE_URL = portalUrl;
  process.env.PORTAL_INGEST_SECRET = SECRET;
  const portal = {
    ingest: await import("../../portal/app/api/ingest/route"),
    open: await import("../../portal/app/api/c/open/route"),
    accept: await import("../../portal/app/api/c/accept/route"),
    snapshot: await import("../../portal/app/api/c/snapshot/route"),
  };
  return { workshop, portal };
}
type Loaded = Awaited<ReturnType<typeof load>>;

type PortalReply = { status: number; headers: Headers; text: string; json: Record<string, unknown> };

describe("workshop sync -> portal -> customer", () => {
  let w: Loaded["workshop"];
  let p: Loaded["portal"];
  let portalUp = true;
  let queued: string[] = [];
  const bodies: string[] = []; // every body the workshop signed, oldest first, for the stale replay
  let n = 0;
  let clienteId: string;
  let openOrderId: string;
  let vehicleIds: string[];

  const enqueue = async (id: string) => void queued.push(id);
  const orderDeps = () => ({ enqueuePortalSync: enqueue, role: "administrador" as const, scope: w.scope.SYSTEM_SCOPE });

  const toPortal: typeof fetch = async (input, init) => {
    if (!portalUp) throw new TypeError("fetch failed"); // what an unreachable host looks like
    bodies.push(String(init?.body));
    return p.ingest.POST(new Request(String(input), init));
  };
  const send = (body: Parameters<typeof w.transport.sendToPortal>[0], c: typeof config) => w.transport.sendToPortal(body, c, toPortal);
  const sync = (id: string) => w.job.runPortalSync(id, { config, send });
  /** The worker: runs every queued job once. A throw leaves the rest queued, like pg-boss would. */
  const drain = async () => {
    while (queued.length > 0) {
      const id = queued[0];
      await sync(id);
      queued.shift();
    }
  };

  const call = async (route: { POST: (r: Request) => Promise<Response> }, token: string): Promise<PortalReply> => {
    const res = await route.POST(
      new Request("http://portal.test/api/c/x", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "x-forwarded-for": `9.9.${Math.floor(++n / 250)}.${n % 250}` },
      }),
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: JSON.parse(text) };
  };
  type Snap = { vehicles: { plate: string; orders: { status: string; hallazgos?: string | null }[] }[] };
  const history = async (token: string) => {
    const r = await call(p.snapshot, token);
    return { ...r, snap: r.json.snapshot as Snap | undefined };
  };
  const token = async () => (await w.db.select().from(w.schema.cliente).where(eq(w.schema.cliente.id, clienteId)))[0].portalToken!;

  beforeAll(async () => {
    ({ workshop: w, portal: p } = await load());
    const { db, schema } = w;
    await db.insert(schema.users).values({ id: ADMIN, username: ADMIN, passwordHash: "x", role: "administrador" });
    const [c] = await db
      .insert(schema.cliente)
      .values({ name: "SENTINEL_NAME", phone: "SENTINEL_PHONE", email: "SENTINEL@MAIL" })
      .returning();
    clienteId = c.id;
    const vehicles = await db
      .insert(schema.vehiculo)
      .values([
        { clienteId, plate: "AAA-111", make: "Toyota", model: "Hilux", year: 2015, chasis: "SENTINEL_CHASIS", colorPrimario: "SENTINEL_COLOR" },
        { clienteId, plate: "BBB-222", make: "Kia", model: "Rio", year: 2020 },
      ])
      .returning();
    vehicleIds = vehicles.map((v) => v.id);
    const orders = await db
      .insert(schema.ordenServicio)
      .values([
        { clienteId, vehiculoId: vehicleIds[0], categoria: "revisado", status: "open", description: "Revisión anual", observaciones: "SENTINEL_OBS" },
        { clienteId, vehiculoId: vehicleIds[0], categoria: "reparacion", status: "in_progress" },
        { clienteId, vehiculoId: vehicleIds[1], categoria: "mant_preventivo", status: "done", completedAt: new Date("2026-09-01T12:00:00Z") },
      ])
      .returning();
    openOrderId = orders[0].id;
    await w.consent.recordConsent(clienteId, true, ADMIN, { enqueuePortalSync: enqueue }); // issues the token
    await drain();
  });

  afterAll(async () => {
    const { db, schema } = w;
    await db.delete(schema.ordenServicio).where(eq(schema.ordenServicio.clienteId, clienteId));
    await db.delete(schema.cliente).where(eq(schema.cliente.id, clienteId));
    await db.delete(schema.users).where(eq(schema.users.id, ADMIN));
  });

  it("shows no plate and no order before the terms are accepted", async () => {
    const t = await token();
    for (const route of [p.open, p.snapshot]) {
      const r = await call(route, t);
      expect(r.json).toEqual({ state: "terms" });
    }
  });

  it("serves exactly the whitelisted data after accept: plates, labels, no internal field", async () => {
    const r = await call(p.accept, await token());
    expect(r.json.state).toBe("accepted");
    const snap = r.json.snapshot as Snap;
    expect(snap.vehicles.map((v) => v.plate).sort()).toEqual(["AAA-111", "BBB-222"]);
    const statuses = snap.vehicles.flatMap((v) => v.orders.map((o) => o.status)).sort();
    expect(statuses).toEqual(["En proceso", "Recibida", "Terminada"]);
    expect(r.text).not.toMatch(/SENTINEL|in_progress|ready_for_review|revisado/);
    expect(r.text).not.toContain(await token()); // the portal never echoes the plaintext token
  });

  it("the portal refuses a body signed with another secret, and an unsigned one, and stores nothing", async () => {
    const before = JSON.stringify((await history(await token())).snap);
    const wrong = w.job.runPortalSync(clienteId, { config: { ...config, secret: "not-the-secret" }, send });
    await expect(wrong).rejects.toBeInstanceOf(w.transport.PortalRejectedError); // 401 is a 4xx: not retried
    const unsigned = await toPortal(config.url, { method: "POST", body: JSON.stringify({ kind: "delete", clienteId, version: 2 ** 40 }) });
    expect(unsigned.status).toBe(401);
    expect(JSON.stringify((await history(await token())).snap)).toBe(before);
  });

  it("an edit reaches the customer after the re-sync", async () => {
    await w.orders.updateOrder(openOrderId, { hallazgos: "Pastillas al 30%" }, orderDeps());
    expect(queued).toEqual([clienteId]);
    await drain();
    const h = await history(await token());
    expect(h.snap?.vehicles.flatMap((v) => v.orders.map((o) => o.hallazgos))).toContain("Pastillas al 30%");
  });

  it("a replayed OLDER signed body does not roll the customer back", async () => {
    const stale = bodies.find((b) => b.includes('"vehicles"'))!; // the first upsert ever sent
    expect(JSON.parse(stale).version).toBeLessThan(JSON.parse(bodies[bodies.length - 1]).version);
    const res = await toPortal(config.url, { method: "POST", body: stale, headers: (await signed(stale)) });
    expect(res.status).toBe(200);
    const h = await history(await token());
    expect(h.snap?.vehicles.flatMap((v) => v.orders.map((o) => o.hallazgos))).toContain("Pastillas al 30%");
  });

  it("offline: edits succeed and the sync throws a retryable error, the portal keeps the old state", async () => {
    portalUp = false;
    for (const note of ["uno", "dos", "tres"]) {
      await w.orders.updateOrder(openOrderId, { hallazgos: note }, orderDeps()); // a user write is never blocked by the portal
    }
    expect(queued).toHaveLength(3);
    const failure = await drain().then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(w.transport.PortalRejectedError); // anything else is retried by pg-boss
    const row = await w.db.select().from(w.schema.ordenServicio).where(eq(w.schema.ordenServicio.id, openOrderId));
    expect(row[0].hallazgos).toBe("tres");

    portalUp = true;
    const stale = await history(await token());
    expect(JSON.stringify(stale.snap)).not.toContain("tres"); // still the old state
  });

  it("the nightly reconcile heals what the queue lost", async () => {
    queued = []; // every job was lost
    await w.reconcile.runPortalReconcile({ config, enqueue, send });
    expect(queued).toEqual([clienteId]);
    await drain();
    const h = await history(await token());
    expect(h.snap?.vehicles.flatMap((v) => v.orders.map((o) => o.hallazgos))).toContain("tres");
  });

  it("with no secret configured nothing leaves the workshop", async () => {
    let calls = 0;
    await w.job.runPortalSync(clienteId, { config: { url: config.url }, send: async () => void calls++ });
    expect(calls).toBe(0);
  });

  it("rotate: the old token is neutral 404, the new one opens", async () => {
    const old = await token();
    await w.consent.rotatePortalToken(clienteId, { enqueuePortalSync: enqueue });
    await drain();
    const fresh = await token();
    expect(fresh).not.toBe(old);
    expect((await call(p.open, old)).status).toBe(404);
    expect((await call(p.open, fresh)).status).toBe(200);
  });

  it("revoke: neutral 404 identical to a token that never existed; re-grant issues a new working token", async () => {
    const before = await token();
    await w.consent.recordConsent(clienteId, false, ADMIN, { enqueuePortalSync: enqueue });
    await drain();
    const gone = await call(p.snapshot, before);
    const never = await call(p.snapshot, "never-issued-token");
    expect(gone.status).toBe(404);
    expect(gone.text).toBe(never.text);
    expect(Object.fromEntries(gone.headers)).toEqual(Object.fromEntries(never.headers));

    await w.consent.recordConsent(clienteId, true, ADMIN, { enqueuePortalSync: enqueue });
    await drain();
    const regranted = await token();
    expect(regranted).not.toBe(before);
    expect((await call(p.open, before)).status).toBe(404);
    expect((await call(p.open, regranted)).status).toBe(200);
  });

  it("deactivate removes the customer from the portal; reactivate brings back the same token", async () => {
    const t = await token();
    await w.customers.deactivateCliente(clienteId, { enqueuePortalSync: enqueue });
    await drain();
    expect((await call(p.open, t)).status).toBe(404);

    await w.customers.reactivateCliente(clienteId, { enqueuePortalSync: enqueue });
    await drain();
    expect(await token()).toBe(t);
    expect((await call(p.open, t)).status).toBe(200);
  });
});

async function signed(raw: string) {
  const { sign } = await import("@portal/contract");
  return { "content-type": "application/json", ...sign(raw, SECRET) };
}
