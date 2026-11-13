/**
 * Usage delivery job -> portal ingest, end to end (usage-metrics WU4, task 4.4).
 * Run it through `npm run test:portal-sync`, which creates both throwaway
 * databases and passes their URLs in.
 *
 * Real: both Postgres databases, `deliverUsage` with its plan SELECT, its
 * window SELECT and its watermark upsert, the real signer in `sendToPortal`,
 * and the portal's ingest route with its HMAC check, parser and SQL. Not real:
 * the socket (the signed Request is handed straight to `POST`, as in
 * `sync.local.ts`) and pg-boss (the schedule is covered by `worker.test.ts`).
 */
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const workshopUrl = process.env.PORTAL_SYNC_WORKSHOP_URL;
const portalUrl = process.env.PORTAL_SYNC_PORTAL_URL;
// Each URL on its own: a concatenation would only ever test the portal's database name.
if (!workshopUrl || !portalUrl || [workshopUrl, portalUrl].some((u) => /\/dforce_(catalog|portal)(\?|$)/.test(u))) {
  throw new Error("test:portal-sync must be run through `npm run test:portal-sync` (it owns the throwaway databases)");
}

const SECRET = "portal-sync-local-secret";
const config = { url: "http://localhost/api/ingest", secret: SECRET };
type Row = { day: string; screen: string; group: string; views: number };

describe("usage delivery -> portal", () => {
  let deliver: typeof import("@/modules/usage/deliver");
  let ingest: typeof import("../../portal/app/api/ingest/route");
  const workshop = new pg.Client({ connectionString: workshopUrl });
  const portal = new pg.Client({ connectionString: portalUrl });
  let today: string;

  const toPortal = vi.fn<typeof fetch>(async (input, init) => ingest.POST(new Request(String(input), init)));
  const rows = async (client: pg.Client, table: string): Promise<Row[]> =>
    (
      await client.query(
        `select to_char(day, 'YYYY-MM-DD') as day, screen, role_group as "group", views from ${table} order by day, screen, role_group`,
      )
    ).rows;
  const watermark = async (): Promise<string | null> =>
    (await workshop.query(`select to_char(acked_through, 'YYYY-MM-DD') as d from usage_delivery where id = 1`)).rows[0].d;
  const setWatermark = (d: string | null) => workshop.query(`update usage_delivery set acked_through = $1::date where id = 1`, [d]);
  const daysAgo = async (n: number): Promise<string> =>
    (await workshop.query(`select to_char($1::date - $2::int, 'YYYY-MM-DD') as d`, [today, n])).rows[0].d;
  const run = (fetchFn: typeof fetch = toPortal) => deliver.deliverUsage({ config, fetch: fetchFn, report: () => {} });

  beforeAll(async () => {
    process.env.DATABASE_URL = workshopUrl;
    deliver = await import("@/modules/usage/deliver");
    process.env.DATABASE_URL = portalUrl;
    process.env.PORTAL_INGEST_SECRET = SECRET;
    ingest = await import("../../portal/app/api/ingest/route");
    await workshop.connect();
    await portal.connect();
    today = (await workshop.query(`select to_char((now() AT TIME ZONE 'America/Panama')::date, 'YYYY-MM-DD') as d`)).rows[0].d;
    // Days today-40 .. today, except today-20 (an empty day); two screens per day.
    await workshop.query(`
      insert into usage_daily (day, screen, role_group, views)
      select $1::date - k, s.screen, s.grp, (k * 7 + s.n) from generate_series(0, 40) k
      cross join (values ('/kanban', 'gestion', 1), ('/service-orders/[id]', 'tecnico', 2)) s(screen, grp, n)
      where k <> 20`, [today]);
  });
  afterAll(async () => {
    await workshop.query("truncate usage_daily");
    await setWatermark(null);
    await portal.query("truncate usage_count, usage_coverage, usage_screen");
    await workshop.end();
    await portal.end();
  });

  it("the window SELECT returns int4 views as numbers and dates as YYYY-MM-DD", async () => {
    const [first] = await deliver.readUsageCounts(await daysAgo(1), await daysAgo(1));
    expect(first).toEqual({ day: await daysAgo(1), screen: "/kanban", group: "gestion", views: 8 });
  });

  // An oracle independent of the SQL under test: Node's own tz database. It disagrees
  // with a wrong zone whenever the two calendars straddle midnight (UTC: 19:00–24:00 Panama).
  it("today is the America/Panama calendar date", async () => {
    const panama = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(new Date());
    expect((await deliver.readUsagePlan()).today).toBe(panama);
  });

  it("the calendar date is Panama's at an instant where UTC, Panama and Tokyo all disagree", async () => {
    const q = new PgDialect().sqlToQuery(
      sql`select to_char(${deliver.panamaDateOf(sql`${"2026-01-01T03:00:00Z"}`)}, 'YYYY-MM-DD') as d`,
    );
    expect((await workshop.query(q.sql, q.params)).rows[0].d).toBe("2025-12-31"); // 22:00 on the 31st in Panama; UTC and Tokyo say 2026-01-01
  });

  it("a null watermark starts from the oldest counted day", async () => {
    await setWatermark(null);
    expect(await deliver.readUsagePlan()).toEqual({ start: await daysAgo(40), today });
  });

  it("a 5xx keeps the watermark", async () => {
    await setWatermark(await daysAgo(41));
    const down = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));
    expect(await run(down)).toBe(0);
    expect(down).toHaveBeenCalledOnce();
    expect(await watermark()).toBe(await daysAgo(41));
  });

  it("a failure on the second batch leaves the watermark at the end of the first", async () => {
    await setWatermark(await daysAgo(41));
    let call = 0;
    const flaky = vi.fn<typeof fetch>(async (input, init) => (++call === 1 ? toPortal(input, init) : new Response("{}", { status: 500 })));
    expect(await run(flaky)).toBe(1);
    expect(await watermark()).toBe(await daysAgo(10));
    await portal.query("truncate usage_count, usage_coverage, usage_screen");
  });

  it("a 40-day-old watermark catches up in 2 batches, ends at yesterday, and the portal holds every row and day", async () => {
    await setWatermark(await daysAgo(41));
    toPortal.mockClear();
    expect(await run()).toBe(2);
    expect(toPortal).toHaveBeenCalledTimes(2);
    expect(await watermark()).toBe(await daysAgo(1));

    const sent = await rows(workshop, "usage_daily");
    expect(sent).toHaveLength(80);
    expect(await rows(portal, "usage_count")).toEqual(sent);
    const covered = (await portal.query(`select to_char(day, 'YYYY-MM-DD') as d from usage_coverage order by day`)).rows.map((r) => r.d);
    expect(covered).toHaveLength(41);
    expect(covered[0]).toBe(await daysAgo(40));
    expect(covered.at(-1)).toBe(today);
    expect(covered).toContain(await daysAgo(20)); // the empty day is covered, not missing
    expect((await portal.query("select count(*)::int as n from usage_screen")).rows[0].n).toBeGreaterThan(0);
  });

  it("the next run resends only today and the portal totals do not change", async () => {
    const before = await rows(portal, "usage_count");
    toPortal.mockClear();
    expect(await run()).toBe(1);
    expect(JSON.parse(String(toPortal.mock.calls[0][1]!.body))).toMatchObject({ from: today, to: today });
    expect(await watermark()).toBe(await daysAgo(1));
    expect(await rows(portal, "usage_count")).toEqual(before);
  });
});
