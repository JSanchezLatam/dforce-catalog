/**
 * Real-SQL proof for usage-metrics WU1. Unit tests inject the upsert, so the
 * ON CONFLICT increment, the Panama-date clock and the CHECKs never reach
 * Postgres there. They do here, on a THROWAWAY database — never the dev one.
 * The role → group → SQL path runs through the real route handler, no deps.
 */
import { execSync } from "node:child_process";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { handleRecordView } from "@/app/api/usage/view/route";
import type { Role } from "@/modules/auth/roles";
import { recordView } from "@/modules/usage/service";
import { db } from "@/shared/db/client";
import { usageDaily, usageDelivery } from "@/shared/db/schema";

// Patterns only this file writes, so a run never touches another describe's rows.
const SCREENS = ["/agenda", "/kanban", "/metrics"];

const post = (role: Role, body: unknown) =>
  handleRecordView(
    new NextRequest("http://localhost/api/usage/view", {
      method: "POST",
      headers: { "x-user-id": `e2e-usage-${role}`, "x-user-role": role, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const rowsFor = (screen: string) => db.select().from(usageDaily).where(eq(usageDaily.screen, screen));

describe("usage_daily (E2E)", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  const clean = () => db.delete(usageDaily).where(inArray(usageDaily.screen, SCREENS));
  beforeEach(clean);
  afterAll(clean);

  it("seeds the single watermark row, unacknowledged, and refuses a second", async () => {
    expect(await db.select().from(usageDelivery)).toEqual([{ id: 1, ackedThrough: null }]);
    await expect(db.insert(usageDelivery).values({ id: 2 })).rejects.toThrow();
  });

  it("an administrador and a jefe_taller on /agenda merge into one gestion row with 2 views", async () => {
    expect((await post("administrador", { screen: "/agenda" })).status).toBe(204);
    expect((await post("jefe_taller", { screen: "/agenda" })).status).toBe(204);
    const rows = await rowsFor("/agenda");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ screen: "/agenda", roleGroup: "gestion", views: 2 });
  });

  it("a técnico counts as tecnico, even when the body names gestion", async () => {
    expect((await post("tecnico", { screen: "/kanban", group: "gestion" })).status).toBe(204);
    expect(await rowsFor("/kanban")).toEqual([expect.objectContaining({ roleGroup: "tecnico", views: 1 })]);
  });

  it("20 concurrent views of the same key are all counted", async () => {
    await Promise.all(Array.from({ length: 20 }, () => recordView("/metrics", "gestion")));
    const [row] = await db
      .select()
      .from(usageDaily)
      .where(and(eq(usageDaily.screen, "/metrics"), eq(usageDaily.roleGroup, "gestion")));
    expect(row.views).toBe(20);
  });

  it("stores the America/Panama date as computed by the database", async () => {
    await recordView("/agenda", "tecnico");
    const { rows } = await db.execute<{ panama: string }>(
      sql`SELECT to_char((now() AT TIME ZONE 'America/Panama')::date, 'YYYY-MM-DD') AS panama`,
    );
    const [row] = await rowsFor("/agenda");
    expect(row.day).toBe(rows[0].panama);
  });

  it("an unknown screen stores nothing", async () => {
    expect((await post("administrador", { screen: "/service-orders/123" })).status).toBe(400);
    expect(await db.select().from(usageDaily).where(eq(usageDaily.screen, "/service-orders/123"))).toEqual([]);
  });

  it("the CHECK refuses a group outside gestion/tecnico", async () => {
    await expect(
      db.execute(sql`INSERT INTO usage_daily (day, screen, role_group, views) VALUES (current_date, '/agenda', 'pantalla', 1)`),
    ).rejects.toThrow();
  });
});
