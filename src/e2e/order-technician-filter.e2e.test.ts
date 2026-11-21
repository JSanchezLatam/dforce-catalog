/**
 * Real-SQL proof for the order list's "Técnico" filter and the "closed in
 * month" filter Métricas links to. Both are WHERE clauses, so only Postgres can
 * prove them. Run against a THROWAWAY database (`dforce_e2e`) — never the dev one.
 *
 * `closedIn` must count exactly what `closedByTecnicoMonth` counts: `done` and
 * `completed_at` inside the month IN PANAMA (UTC-5, no DST), so the edges below
 * sit five hours off the UTC month boundary.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { purgeHistory } from "./purge-history";
import { cliente, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { countOrdenesServicio, listOrdenesServicio } from "../modules/service-orders/queries";
import { orderScope } from "../modules/service-orders/scope";

describe("order list: técnico and closed-in-month filters (E2E)", () => {
  const stamp = Date.now();
  const search = `Filtro Tecnico ${stamp}`;
  const page = { offset: 0, limit: 50 };
  const madeUsers: string[] = [];
  let admin: { id: string; role: string };
  let tecUserB: { id: string; role: string };
  let clienteId: string;
  let vehiculoId: string;
  let t1: string;
  let t2: string;
  const o: Record<string, string> = {};

  const insertUser = async (suffix: string, role: "tecnico" | "administrador") => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-tfilter-${suffix}-${stamp}`, passwordHash: "x", role })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    return { id: u.id, role };
  };
  const newOrder = async (completedAt?: string) =>
    (
      await db
        .insert(ordenServicio)
        .values({
          clienteId,
          vehiculoId,
          categoria: "revisado",
          ...(completedAt ? { status: "done" as const, completedAt: new Date(completedAt) } : {}),
        })
        .returning({ id: ordenServicio.id })
    )[0].id;
  const assign = (ordenId: string, tecnicoId: string) => db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: admin.id });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
  const sorted = (...keys: string[]) => keys.map((k) => o[k]).sort();

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    admin = await insertUser("admin", "administrador");
    tecUserB = await insertUser("b", "tecnico");
    [{ id: t1 }] = await db.insert(tecnico).values({ nombre: `Filtro Uno ${stamp}` }).returning({ id: tecnico.id });
    [{ id: t2 }] = await db.insert(tecnico).values({ nombre: `Filtro Dos ${stamp}`, userId: tecUserB.id }).returning({ id: tecnico.id });
    const [c] = await db.insert(cliente).values({ name: search, phone: "50769994101" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "TFI001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;

    o.novT1 = await newOrder("2026-11-10T15:00:00Z");
    o.octEdgeT1 = await newOrder("2026-11-01T04:30:00Z"); // 31 Oct 23:30 in Panama
    o.decEdgeT1 = await newOrder("2026-12-01T05:00:00Z"); // 1 Dec 00:00 in Panama
    o.openT1 = await newOrder();
    o.novT2 = await newOrder("2026-11-20T15:00:00Z");
    o.novShared = await newOrder("2026-11-21T15:00:00Z");
    for (const k of ["novT1", "octEdgeT1", "decEdgeT1", "openT1", "novShared"]) await assign(o[k], t1);
    for (const k of ["novT2", "novShared"]) await assign(o[k], t2);
  }, 60_000);

  afterAll(async () => {
    const orders = Object.values(o);
    await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await purgeHistory([clienteId]);
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, [t1, t2]));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  it("tecnicoId: every order assigned to that técnico, whatever its status, and a shared order too", async () => {
    const rows = await listOrdenesServicio({ search, tecnicoId: t1 }, page, orderScope(admin));
    expect(ids(rows)).toEqual(sorted("novT1", "octEdgeT1", "decEdgeT1", "openT1", "novShared"));
    expect(await countOrdenesServicio({ search, tecnicoId: t1 }, orderScope(admin))).toBe(5);
  });

  it("closedIn: done orders whose completion falls in that month in Panama, edges excluded", async () => {
    expect(ids(await listOrdenesServicio({ search, closedIn: "2026-11" }, page, orderScope(admin)))).toEqual(
      sorted("novT1", "novT2", "novShared"),
    );
    expect(ids(await listOrdenesServicio({ search, closedIn: "2026-10" }, page, orderScope(admin)))).toEqual(sorted("octEdgeT1"));
    expect(ids(await listOrdenesServicio({ search, closedIn: "2026-12" }, page, orderScope(admin)))).toEqual(sorted("decEdgeT1"));
  });

  it("both together: what Métricas counted for that técnico and month, and the pager agrees", async () => {
    const filters = { search, tecnicoId: t1, closedIn: "2026-11" };
    expect(ids(await listOrdenesServicio(filters, page, orderScope(admin)))).toEqual(sorted("novT1", "novShared"));
    expect(await countOrdenesServicio(filters, orderScope(admin))).toBe(2);
  });

  it("the caller's scope still applies: a técnico filtering by another técnico sees only orders shared with them", async () => {
    expect(ids(await listOrdenesServicio({ search, tecnicoId: t1 }, page, orderScope(tecUserB)))).toEqual(sorted("novShared"));
  });
});
