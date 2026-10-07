/**
 * Real SQL, throwaway database (never `dforce_portal`):
 *   DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_portal_e2e npm run test:e2e
 * Goes through the real route handlers.
 */
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as accept } from "../app/api/c/accept/route";
import { POST as open } from "../app/api/c/open/route";
import { POST as snapshot } from "../app/api/c/snapshot/route";
import { db } from "../src/db/client";
import { portalCustomer, portalTermsAcceptance } from "../src/db/schema";
import { hashToken } from "../src/portal/lookup";
import { TERMS_VERSION } from "../src/terms";

const snap = (plate: string) => ({
  generatedAt: "2026-10-01T10:00:00.000Z",
  vehicles: [{ id: "v1", plate, make: "Toyota", model: null, year: 2015, orders: [] }],
});
let n = 0;
const call = (route: typeof open, token: string, ip?: string) =>
  route(
    new Request("http://portal.test/api/c/x", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "x-forwarded-for": ip ?? `8.8.${Math.floor(++n / 250)}.${n % 250}` },
    }),
  );
const seed = (clienteId: string, token: string | null, plate = "AB1234") =>
  db.insert(portalCustomer).values({
    clienteId,
    tokenHash: token && hashToken(token),
    snapshot: token ? snap(plate) : null,
    version: 1,
  });
const acceptances = () => db.select().from(portalTermsAcceptance);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../src/db/migrations") });
});
beforeEach(async () => {
  await db.delete(portalCustomer);
  await db.delete(portalTermsAcceptance);
});
afterAll(async () => {
  await db.delete(portalCustomer);
  await db.delete(portalTermsAcceptance);
});

describe("portal API e2e", () => {
  it("open without acceptance says terms and carries no customer data; snapshot too", async () => {
    await seed("c1", "tok-a");
    const o = await call(open, "tok-a");
    expect(await o.json()).toEqual({ state: "terms" });
    const s = await call(snapshot, "tok-a");
    expect(await s.json()).toEqual({ state: "terms" });
  });

  it("accept inserts exactly one row (hash, version, time) and returns the snapshot", async () => {
    await seed("c1", "tok-a");
    const res = await call(accept, "tok-a");
    expect(await res.json()).toEqual({ state: "accepted", snapshot: snap("AB1234") });
    await call(accept, "tok-a");
    const rows = await acceptances();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokenHash: hashToken("tok-a"), termsVersion: TERMS_VERSION });
    expect(rows[0].acceptedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(rows)).not.toContain("tok-a");
  });

  it("after accept, open says accepted and snapshot returns the data", async () => {
    await seed("c1", "tok-a");
    await call(accept, "tok-a");
    expect(await (await call(open, "tok-a")).json()).toEqual({ state: "accepted" });
    expect(await (await call(snapshot, "tok-a")).json()).toEqual({ state: "accepted", snapshot: snap("AB1234") });
  });

  it("an acceptance of an older terms version re-gates", async () => {
    await seed("c1", "tok-a");
    await db.insert(portalTermsAcceptance).values({ tokenHash: hashToken("tok-a"), termsVersion: "old-version" });
    expect(await (await call(open, "tok-a")).json()).toEqual({ state: "terms" });
    expect(await (await call(snapshot, "tok-a")).json()).toEqual({ state: "terms" });
    await call(accept, "tok-a");
    expect(await (await call(open, "tok-a")).json()).toEqual({ state: "accepted" });
    expect(await acceptances()).toHaveLength(2);
  });

  it("customers A and B never see each other's data", async () => {
    await seed("c1", "tok-a", "AAA111");
    await seed("c2", "tok-b", "BBB222");
    await call(accept, "tok-a");
    await call(accept, "tok-b");
    const a = JSON.stringify(await (await call(snapshot, "tok-a")).json());
    const b = JSON.stringify(await (await call(snapshot, "tok-b")).json());
    expect(a).toContain("AAA111");
    expect(a).not.toContain("BBB222");
    expect(b).toContain("BBB222");
    expect(b).not.toContain("AAA111");
  });

  it("tombstoning an accepted customer hides the data", async () => {
    await seed("c1", "tok-a");
    await call(accept, "tok-a");
    await db.update(portalCustomer).set({ tokenHash: null, snapshot: null }).where(eq(portalCustomer.clienteId, "c1"));
    for (const route of [open, accept, snapshot]) expect((await call(route, "tok-a")).status).toBe(404);
  });

  it("revoked, rotated-away, tombstoned and never-issued tokens give byte-equal 404s on every route", async () => {
    await seed("revoked", "tok-revoked");
    await db.update(portalCustomer).set({ tokenHash: null }).where(eq(portalCustomer.clienteId, "revoked"));
    await seed("rotated", "tok-old");
    await db.update(portalCustomer).set({ tokenHash: hashToken("tok-new") }).where(eq(portalCustomer.clienteId, "rotated"));
    await seed("gone", null);
    for (const route of [open, accept, snapshot]) {
      const responses = [];
      for (const t of ["tok-revoked", "tok-old", "tok-gone", "tok-never", ""]) {
        const res = await call(route, t);
        responses.push({ status: res.status, body: await res.text(), headers: [...res.headers] });
      }
      expect(responses[0].status).toBe(404);
      expect(responses[0].body).toBe('{"state":"invalid"}');
      for (const r of responses) expect(r).toEqual(responses[0]);
    }
    expect(await acceptances()).toHaveLength(0);
  });

  it("the 31st request from one IP is 429", async () => {
    await seed("c1", "tok-a");
    for (let i = 0; i < 30; i++) expect((await call(open, "tok-a", "6.6.6.6")).status).toBe(200);
    expect((await call(open, "tok-a", "6.6.6.6")).status).toBe(429);
  });
});
