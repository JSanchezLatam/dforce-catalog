/**
 * Usage ingest against the portal's real route handler and a real Postgres
 * (usage-metrics WU3). Run it through `npm run test:portal-sync`, which creates
 * the throwaway portal database, migrates it and passes its URL in.
 *
 * Real: the HMAC check, the parser, the transaction and its SQL. The bodies are
 * signed exactly as the workshop signs them and handed to `POST` directly.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IngestBody } from "@portal/contract";

const workshopUrl = process.env.PORTAL_SYNC_WORKSHOP_URL;
const portalUrl = process.env.PORTAL_SYNC_PORTAL_URL;
if (!workshopUrl || !portalUrl || /\/dforce_(catalog|portal)$/.test(workshopUrl + portalUrl)) {
  throw new Error("test:portal-sync must be run through `npm run test:portal-sync` (it owns the throwaway databases)");
}

const SECRET = "portal-sync-local-secret";
type Usage = Extract<IngestBody, { kind: "usage" }>;
type Count = Usage["counts"][number];

const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("usage ingest -> portal tables", () => {
  let ingest: typeof import("../../portal/app/api/ingest/route");
  let sign: typeof import("@portal/contract").sign;
  const client = new pg.Client({ connectionString: portalUrl });

  const post = async (body: unknown) => {
    const raw = JSON.stringify(body);
    const res = await ingest.POST(new Request("http://portal.test/api/ingest", { method: "POST", body: raw, headers: sign(raw, SECRET) }));
    return res.status;
  };
  const counts = async (): Promise<Count[]> =>
    (
      await client.query(
        `select to_char(day, 'YYYY-MM-DD') as day, screen, role_group as "group", views from usage_count order by day, screen, role_group`,
      )
    ).rows;
  const coverage = async (): Promise<{ day: string; received_at: Date }[]> =>
    (await client.query(`select to_char(day, 'YYYY-MM-DD') as day, received_at from usage_coverage order by day`)).rows;
  const screens = async () => (await client.query(`select pattern, label from usage_screen order by pattern`)).rows;
  const reset = () => client.query("truncate usage_count, usage_coverage, usage_screen");

  const catalog = [
    { pattern: "/kanban", label: "Tablero" },
    { pattern: "/service-orders", label: "Órdenes de servicio" },
  ];
  /** Days 1–10: kanban/gestion = d views, service-orders/tecnico = 100 + d. */
  const seed: Usage = {
    kind: "usage",
    from: day(1),
    to: day(10),
    screens: catalog,
    counts: range(1, 10).flatMap((d) => [
      { day: day(d), screen: "/kanban", group: "gestion" as const, views: d },
      { day: day(d), screen: "/service-orders", group: "tecnico" as const, views: 100 + d },
    ]),
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = portalUrl;
    process.env.PORTAL_INGEST_SECRET = SECRET;
    ingest = await import("../../portal/app/api/ingest/route");
    ({ sign } = await import("@portal/contract"));
    await client.connect();
  });
  afterAll(async () => {
    await reset();
    await client.end();
  });

  it("replaces only the declared range: days 5–7 equal the batch, 1–4 and 8–10 are untouched", async () => {
    await reset();
    expect(await post(seed)).toBe(200);
    const before = await counts();
    const coveredBefore = await coverage();
    expect(before).toHaveLength(20);

    // Day 5 drops service-orders and changes kanban; day 6 adds a new screen; day 7 has nothing at all.
    const batch: Usage = {
      kind: "usage",
      from: day(5),
      to: day(7),
      screens: catalog,
      counts: [
        { day: day(5), screen: "/kanban", group: "gestion", views: 55 },
        { day: day(6), screen: "/kanban", group: "tecnico", views: 66 },
      ],
    };
    expect(await post(batch)).toBe(200);

    const after = await counts();
    const outside = (rows: Count[]) => rows.filter((r) => r.day < day(5) || r.day > day(7));
    expect(outside(after)).toEqual(outside(before));
    expect(after.filter((r) => r.day >= day(5) && r.day <= day(7))).toEqual(batch.counts);

    // Coverage outside the range keeps its original received_at; inside it is re-stamped.
    const coveredAfter = await coverage();
    expect(coveredAfter.map((c) => c.day)).toEqual(range(1, 10).map(day));
    const stamp = (rows: typeof coveredAfter, d: number) => rows.find((r) => r.day === day(d))!.received_at.getTime();
    for (const d of [1, 4, 8, 10]) expect(stamp(coveredAfter, d), day(d)).toBe(stamp(coveredBefore, d));
    for (const d of [5, 6, 7]) expect(stamp(coveredAfter, d), day(d)).toBeGreaterThan(stamp(coveredBefore, d));
  });

  it("an empty Sunday inside the range is covered with zero views, not missing", async () => {
    await reset();
    expect(new Date(day(11)).getUTCDay()).toBe(0); // 2026-10-11 is a Sunday
    const batch: Usage = {
      kind: "usage",
      from: day(10),
      to: day(12),
      screens: catalog,
      counts: [
        { day: day(10), screen: "/kanban", group: "gestion", views: 4 },
        { day: day(12), screen: "/kanban", group: "gestion", views: 6 },
      ],
    };
    expect(await post(batch)).toBe(200);
    expect((await coverage()).map((c) => c.day)).toEqual([day(10), day(11), day(12)]);
    expect((await counts()).filter((r) => r.day === day(11))).toEqual([]);
  });

  it("resending the same range with the same counts leaves the totals unchanged", async () => {
    await reset();
    expect(await post(seed)).toBe(200);
    const once = await counts();
    expect(await post(seed)).toBe(200);
    expect(await counts()).toEqual(once);
    const { rows } = await client.query("select sum(views)::int as total from usage_count");
    expect(rows[0].total).toBe(seed.counts.reduce((s, c) => s + c.views, 0));
  });

  it("replaces the screen catalog whole with the one in the latest batch", async () => {
    await reset();
    expect(await post(seed)).toBe(200);
    expect(await screens()).toEqual(catalog);
    const next = [
      { pattern: "/agenda", label: "Agenda" },
      { pattern: "/kanban", label: "Tablero de trabajo" },
    ];
    expect(await post({ ...seed, screens: next })).toBe(200);
    expect(await screens()).toEqual(next);
  });

  it("a usage body with a user field is 400 and changes nothing", async () => {
    await reset();
    expect(await post(seed)).toBe(200);
    const snapshot = JSON.stringify([await counts(), await coverage(), await screens()]);
    const withUser = { ...seed, from: day(5), to: day(7), counts: [{ day: day(5), screen: "/kanban", group: "gestion", views: 1, username: "ana" }] };
    expect(await post(withUser)).toBe(400);
    expect(await post({ ...seed, username: "ana" })).toBe(400);
    expect(JSON.stringify([await counts(), await coverage(), await screens()])).toBe(snapshot);
  });
});
