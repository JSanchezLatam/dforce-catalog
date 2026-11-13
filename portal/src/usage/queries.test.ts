import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isStale, parseRange, usageReport } from "./queries";

// The real SQL (generate_series, the coverage join, the Panama clock) is proven by
// e2e/usage.e2e.test.ts. Here: the text sent through db.execute, and the wire-to-type mapping.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../db/client", () => ({ db: { execute } }));

const dialect = new PgDialect();
const sent = () => execute.mock.calls.map(([q]) => dialect.sqlToQuery(q as SQL));
const find = (needle: string) => {
  const q = sent().find((s) => s.sql.includes(needle));
  if (!q) throw new Error(`no query contains ${needle}`);
  return q;
};

// What node-postgres hands back through drizzle's raw execute: sum() is bigint and
// extract() is numeric, so both arrive as STRINGS; date casts to text are strings too.
const wire: Record<string, unknown[]> = {
  meta: [{ today: "2026-11-11", newest: "1762570800.123456", newest_age: 4 }],
  days: [
    { day: "2026-11-10", covered: true, gestion: "12", tecnico: "30" },
    { day: "2026-11-11", covered: false, gestion: "0", tecnico: "0" },
  ],
  screens: [{ screen: "/kanban", role_group: "gestion", views: "9" }, { screen: "/kanban", role_group: "tecnico", views: "22" }],
  catalog: [{ pattern: "/kanban", label: "Órdenes en curso" }],
  seen: [{ screen: "/builder", last: "2026-09-22" }],
};

beforeEach(() => {
  wire.meta = [{ today: "2026-11-11", newest: "1762570800.123456", newest_age: 4 }];
  execute.mockReset().mockImplementation(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    const key = text.includes("generate_series") ? "days" : text.includes("from usage_screen") ? "catalog" : text.includes("max(day)") ? "seen" : text.includes("role_group") ? "screens" : "meta";
    return { rows: wire[key] };
  });
});

describe("parseRange", () => {
  it("accepts 7, 30 and 90", () => {
    expect([parseRange("7"), parseRange("30"), parseRange("90")]).toEqual([7, 30, 90]);
  });
  it("falls back to 30 for anything else", () => {
    expect([parseRange(undefined), parseRange("14"), parseRange("7 "), parseRange(["7", "90"]), parseRange("")]).toEqual([30, 30, 30, 30, 30]);
  });
});

describe("isStale", () => {
  const newest = new Date("2026-11-10T12:00:00Z");
  it("is not stale at exactly one day", () => {
    expect(isStale(newest, new Date("2026-11-11T12:00:00Z"))).toBe(false);
  });
  it("is stale one millisecond past one day", () => {
    expect(isStale(newest, new Date("2026-11-11T12:00:00.001Z"))).toBe(true);
  });
});

describe("usageReport", () => {
  it("ends every range at today's date in Panama, computed in SQL", async () => {
    await usageReport(30);
    const panama = "(now() at time zone 'America/Panama')::date";
    for (const needle of ["generate_series", "group by u.screen", "max(day)", "newest_age"]) expect(find(needle).sql).toContain(panama);
  });

  it("asks for N days ending today: N-1 days back, as an int", async () => {
    await usageReport(7);
    expect(find("generate_series").params).toEqual([6]);
    expect(find("group by u.screen").params).toEqual([6]);
    expect(find("generate_series").sql).toContain("::int");
  });

  it("counts views only on covered days, in the series and in the per-screen totals", async () => {
    await usageReport(30);
    expect(find("generate_series").sql).toMatch(/left join usage_count u on u\.day = c\.day/);
    expect(find("group by u.screen").sql).toMatch(/from usage_count u join usage_coverage c on c\.day = u\.day/);
  });

  it("converts the string wire to numbers and dates", async () => {
    const r = await usageReport(30);
    expect(r.today).toBe("2026-11-11");
    expect(r.newest).toEqual(new Date(1762570800123));
    expect(r.newestAgeDays).toBe(4);
    expect(r.days).toEqual([
      { day: "2026-11-10", covered: true, gestion: 12, tecnico: 30 },
      { day: "2026-11-11", covered: false, gestion: 0, tecnico: 0 },
    ]);
    expect(r.screens).toEqual([{ screen: "/kanban", gestion: 9, tecnico: 22 }]);
    expect(r.catalog).toEqual([{ pattern: "/kanban", label: "Órdenes en curso" }]);
    expect(r.lastSeen).toEqual({ "/builder": "2026-09-22" });
  });

  it("reports no newest date when nothing was ever received", async () => {
    wire.meta = [{ today: "2026-11-11", newest: null, newest_age: null }];
    const r = await usageReport(30);
    expect(r.newest).toBeNull();
    expect(r.newestAgeDays).toBeNull();
  });
});
