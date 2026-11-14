/**
 * Real SQL, throwaway database (`dforce_portal_test`, never `dforce_portal`):
 *   DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_portal_test npm run test:e2e
 * What the unit tests cannot see: generate_series and its parameter typing, the coverage
 * joins, the Panama clock, and what node-postgres really hands back.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../src/db/client";
import { usageCount, usageCoverage, usageScreen } from "../src/db/schema";
import { usageReport } from "../src/usage/queries";

const panamaToday = async () => String((await db.execute(sql`select (now() at time zone 'America/Panama')::date::text as d`)).rows[0].d);
const ago = (today: string, n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const clear = async () => {
  await db.delete(usageCount);
  await db.delete(usageCoverage);
  await db.delete(usageScreen);
};

let today: string;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../src/db/migrations") });
  today = await panamaToday();
});
beforeEach(clear);
afterAll(async () => {
  await clear();
  await db.$client.end();
});

describe("usageReport against Postgres", () => {
  it("returns nothing received on an empty database", async () => {
    const r = await usageReport(30);
    expect(r.newest).toBeNull();
    expect(r.days).toHaveLength(30);
    expect(r.days.every((d) => !d.covered)).toBe(true);
  });

  it("ends the range on today's Panama date and spans exactly N days", async () => {
    const want = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(new Date());
    for (const n of [7, 30, 90] as const) {
      const r = await usageReport(n);
      expect(r.today).toBe(want);
      expect(r.days).toHaveLength(n);
      expect(r.days.at(-1)?.day).toBe(want);
      expect(r.days[0].day).toBe(ago(want, n - 1));
    }
  });

  it("with 4 of 30 days uncovered: 26 covered, and their views count nowhere", async () => {
    for (let i = 4; i < 30; i++) await db.insert(usageCoverage).values({ day: ago(today, i) });
    for (let i = 0; i < 30; i++)
      await db.insert(usageCount).values([
        { day: ago(today, i), screen: "/kanban", roleGroup: "gestion", views: 2 },
        { day: ago(today, i), screen: "/kanban", roleGroup: "tecnico", views: 3 },
      ]);
    const r = await usageReport(30);
    expect(r.days.filter((d) => d.covered)).toHaveLength(26);
    expect(r.days.slice(-4).every((d) => !d.covered && d.gestion === 0 && d.tecnico === 0)).toBe(true);
    expect(r.days[0]).toEqual({ day: ago(today, 29), covered: true, gestion: 2, tecnico: 3 });
    expect(r.screens).toEqual([{ screen: "/kanban", gestion: 52, tecnico: 78 }]);
  });

  it("leaves days before the range out of the totals", async () => {
    await db.insert(usageCoverage).values([{ day: ago(today, 0) }, { day: ago(today, 7) }]);
    await db.insert(usageCount).values([
      { day: ago(today, 0), screen: "/agenda", roleGroup: "gestion", views: 1 },
      { day: ago(today, 7), screen: "/agenda", roleGroup: "gestion", views: 100 },
    ]);
    expect((await usageReport(7)).screens).toEqual([{ screen: "/agenda", gestion: 1, tecnico: 0 }]);
    expect((await usageReport(30)).screens).toEqual([{ screen: "/agenda", gestion: 101, tecnico: 0 }]);
  });

  it("reads the newest delivery as a Date, its Panama age in days, the catalog and the last visit", async () => {
    await db.insert(usageCoverage).values({ day: ago(today, 50), receivedAt: sql`now() - interval '3 days'` });
    await db.insert(usageCount).values({ day: ago(today, 50), screen: "/builder", roleGroup: "gestion", views: 4 });
    await db.insert(usageScreen).values([{ pattern: "/builder", label: "Generar Catálogos" }, { pattern: "/agenda", label: "Agenda" }]);
    const r = await usageReport(30);
    expect(r.newest).toBeInstanceOf(Date);
    expect(Date.now() - (r.newest as Date).getTime()).toBeGreaterThan(3 * 86_400_000 - 60_000);
    expect(r.newestAgeDays).toBe(3);
    expect(r.catalog).toEqual([{ pattern: "/agenda", label: "Agenda" }, { pattern: "/builder", label: "Generar Catálogos" }]);
    expect(r.lastSeen).toEqual({ "/builder": ago(today, 50) });
    expect(r.screens).toEqual([]);
  });

  it("looks back only 90 days for the last visit", async () => {
    await db.insert(usageCoverage).values({ day: ago(today, 90) });
    await db.insert(usageCount).values({ day: ago(today, 90), screen: "/builder", roleGroup: "gestion", views: 4 });
    expect((await usageReport(30)).lastSeen).toEqual({});
  });
});
