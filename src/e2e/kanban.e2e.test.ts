/**
 * Real-SQL proof for kanban-board WU2. The unit tests inject the data, so they prove nothing about
 * the three new `boardOrders` columns or the `viewerAssignments` join (the `WHERE`, the
 * `deactivated_at` filter, the `LEFT JOIN` scoped to the board's ids). Run against the THROWAWAY
 * `dforce_e2e` database only. The board reads every open order, so each assertion filters to the
 * ids this file seeded.
 */
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import type { Role } from "@/modules/auth/roles";
import type { KanbanSnapshot } from "@/modules/kanban/shape";
import { GET as boardGET } from "../app/api/board/route";
import { handleUpdateOrdenServicio } from "../app/api/service-orders/[id]/route";
import { GET as kanbanGET } from "../app/api/kanban/route";
import { purgeHistory } from "./purge-history";

const SENTINEL_NAME = "SENTINEL_KANBAN_CUSTOMER_NAME";
const SENTINEL_PHONE = "50769990003";

describe("kanban read model (E2E)", () => {
  const stamp = Date.now();
  const ids = { a: "", b: "", c: "", jefe: "", admin: "" };
  const orders = { aOrder: "", bOrder: "", booked: "", held: "" };
  let clienteId: string;
  let techIds: string[] = [];

  const asUser = (id: string, role: Role) => ({ "x-user-id": id, "x-user-role": role });
  const kanbanAs = async (id: string, role: Role): Promise<KanbanSnapshot> => {
    const res = await kanbanGET(new NextRequest("http://localhost/api/kanban", { headers: asUser(id, role) }));
    expect(res.status).toBe(200);
    return res.json();
  };
  const mineOf = (s: KanbanSnapshot) => Object.fromEntries(s.rows.filter((r) => Object.values(orders).includes(r.id)).map((r) => [r.id, r.mine]));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const make = async (key: keyof typeof ids, role: Role) => {
      const [u] = await db.insert(users).values({ username: `e2e-kanban-${key}-${stamp}`, passwordHash: "x", role }).returning({ id: users.id });
      ids[key] = u.id;
    };
    await make("a", "tecnico");
    await make("b", "tecnico");
    await make("c", "tecnico");
    await make("jefe", "jefe_taller");
    await make("admin", "administrador");
    const roster = async (userId: string, nombre: string, deactivated = false) =>
      (await db.insert(tecnico).values({ nombre, userId, deactivatedAt: deactivated ? new Date() : null }).returning({ id: tecnico.id }))[0].id;
    const techA = await roster(ids.a, `Kanban Ana ${stamp}`);
    const techB = await roster(ids.b, `Kanban Beto ${stamp}`);
    const techC = await roster(ids.c, `Kanban Baja ${stamp}`, true);
    techIds = [techA, techB, techC];

    const [c] = await db.insert(cliente).values({ name: SENTINEL_NAME, phone: SENTINEL_PHONE }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: `KB${stamp}`, make: "Toyota", model: "Hilux", motor: "combustion" }).returning({ id: vehiculo.id });
    const order = async (o: Partial<typeof ordenServicio.$inferInsert>) =>
      (await db.insert(ordenServicio).values({ clienteId, vehiculoId: v.id, categoria: "reparacion", ...o }).returning({ id: ordenServicio.id }))[0].id;
    orders.aOrder = await order({ status: "in_progress", urgenteAt: new Date("2031-03-10T13:00:00Z"), urgenteBy: ids.admin });
    orders.bOrder = await order({ status: "open" });
    orders.booked = await order({ status: "booked", vehiculoId: null, categoria: null });
    orders.held = await order({ status: "on_hold", esperaMotivo: "repuesto" });
    const assign = (ordenId: string, tecnicoId: string) => db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: ids.admin });
    await assign(orders.aOrder, techA);
    await assign(orders.bOrder, techB);
    await assign(orders.held, techC); // a deactivated technician's assignment
  }, 60_000);

  afterAll(async () => {
    await purgeHistory([clienteId]);
    await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, Object.values(orders)));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.id, techIds));
    await db.delete(users).where(inArray(users.id, Object.values(ids)));
    await db.$client.end();
  });

  it("the new select columns arrive: urgent from urgente_at, categoria, and missing from vehiculo_id / categoria", async () => {
    const rows = (await kanbanAs(ids.admin, "administrador")).rows;
    const byId = (id: string) => rows.find((r) => r.id === id)!;

    expect(byId(orders.aOrder)).toMatchObject({ urgent: true, categoria: "reparacion", missing: [], plate: `KB${stamp}` });
    expect(byId(orders.bOrder)).toMatchObject({ urgent: false, missing: [] });
    expect(byId(orders.booked)).toMatchObject({ plate: "Sin vehículo", categoria: null, missing: ["vehiculo", "categoria"] });
  });

  it("mine is per viewer: A's order is true for A and false for B, and the reverse", async () => {
    const forA = await kanbanAs(ids.a, "tecnico");
    const forB = await kanbanAs(ids.b, "tecnico");

    expect(mineOf(forA)).toEqual({ [orders.aOrder]: true, [orders.bOrder]: false, [orders.booked]: false, [orders.held]: false });
    expect(mineOf(forB)).toEqual({ [orders.aOrder]: false, [orders.bOrder]: true, [orders.booked]: false, [orders.held]: false });
    expect([forA.onRoster, forB.onRoster]).toEqual([true, true]);
  });

  it("a viewer with no roster row is off the roster and owns nothing", async () => {
    const forJefe = await kanbanAs(ids.jefe, "jefe_taller");

    expect(forJefe.onRoster).toBe(false);
    expect(Object.values(mineOf(forJefe)).every((m) => m === false)).toBe(true);
  });

  it("a deactivated roster row is excluded: off the roster, and its assignment is not mine", async () => {
    const forC = await kanbanAs(ids.c, "tecnico");

    expect(forC.onRoster).toBe(false);
    expect(mineOf(forC)[orders.held]).toBe(false);
  });

  it("the kanban payload carries no customer data, not even through the real query", async () => {
    const res = await kanbanGET(new NextRequest("http://localhost/api/kanban", { headers: asUser(ids.admin, "administrador") }));
    const text = await res.text();

    expect(text).not.toContain(SENTINEL_NAME);
    expect(text).not.toContain(SENTINEL_PHONE);
  });

  it("/api/board stays clean: urgent reaches the TV row, but id, missing, mine and categoria never do", async () => {
    const res = await boardGET(new NextRequest("http://localhost/api/board", { headers: asUser(ids.admin, "administrador") }));
    const text = await res.text();
    const rows: Record<string, unknown>[] = JSON.parse(text).rows;
    const urgent = rows.find((r) => r.plate === `KB${stamp}` && r.urgent === true);

    expect(urgent).toBeDefined();
    expect(text).not.toMatch(/"(id|missing|mine|categoria)"/);
    for (const id of Object.values(orders)) expect(text).not.toContain(id);
    expect(text).not.toContain(SENTINEL_NAME);
  });

  it("a técnico's PATCH of an order status is refused by the server and nothing moves", async () => {
    const res = await handleUpdateOrdenServicio(
      new NextRequest(`http://localhost/api/service-orders/${orders.aOrder}`, {
        method: "PATCH",
        headers: { ...asUser(ids.a, "tecnico"), "content-type": "application/json" },
        body: JSON.stringify({ status: "on_hold", esperaMotivo: "repuesto", expectedStatus: "in_progress" }),
      }),
      orders.aOrder,
    );

    expect(res.status).toBe(403);
    expect((await db.select({ status: ordenServicio.status }).from(ordenServicio).where(eq(ordenServicio.id, orders.aOrder)))[0].status).toBe("in_progress");
  });
});
