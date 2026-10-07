/**
 * Real-SQL proof for technicians-and-work-lines WU4a: the técnico order scope
 * is a WHERE clause, so only Postgres can prove it. One row per scoped read
 * path (the lock is WU4b). Run against a THROWAWAY database (`dforce_e2e`) —
 * never the dev one.
 */
import { execSync } from "node:child_process";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, ordenServicioFoto, ordenTecnico, tecnico, users, vehiculo } from "@/shared/db/schema";
import { getClienteById } from "../modules/customers/queries";
import { findOrderPhoto, listOrderPhotos } from "../modules/service-orders/photos";
import {
  countOrdenesServicio,
  getOrdenServicioById,
  listOrdenesByVehiculo,
  listOrdenesServicio,
} from "../modules/service-orders/queries";
import { orderScope, SYSTEM_SCOPE } from "../modules/service-orders/scope";

describe("técnico order scope (E2E)", () => {
  const stamp = Date.now();
  const madeUsers: string[] = [];
  const page = { offset: 0, limit: 50 };
  let admin: { id: string; role: string };
  let tecA: { id: string; role: string }; // assigned to `mine`
  let tecNoRoster: { id: string; role: string }; // a login with no roster row
  let tecOff: { id: string; role: string }; // deactivated roster row, assigned to `historic`
  let clienteId: string;
  let vehiculoId: string;
  let mine: string; // assigned to tecA
  let theirs: string; // assigned to nobody
  let historic: string; // assigned to the deactivated técnico

  const insertUser = async (suffix: string, role: "tecnico" | "administrador") => {
    const [u] = await db
      .insert(users)
      .values({ username: `e2e-scope-${suffix}-${stamp}`, passwordHash: "x", role })
      .returning({ id: users.id });
    madeUsers.push(u.id);
    return { id: u.id, role };
  };
  const newOrder = async () =>
    (await db.insert(ordenServicio).values({ clienteId, vehiculoId, categoria: "revisado" }).returning({ id: ordenServicio.id }))[0].id;
  const assign = (ordenId: string, tecnicoId: string) =>
    db.insert(ordenTecnico).values({ ordenId, tecnicoId, assignedBy: admin.id });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    admin = await insertUser("admin", "administrador");
    tecA = await insertUser("a", "tecnico");
    tecNoRoster = await insertUser("noroster", "tecnico");
    tecOff = await insertUser("off", "tecnico");
    const [rowA] = await db.insert(tecnico).values({ nombre: "Scope A", userId: tecA.id }).returning({ id: tecnico.id });
    const [rowOff] = await db
      .insert(tecnico)
      .values({ nombre: "Scope Off", userId: tecOff.id, deactivatedAt: new Date() })
      .returning({ id: tecnico.id });
    const [c] = await db.insert(cliente).values({ name: "Pérez Scope", phone: "50769994001" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "SCO001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
    mine = await newOrder();
    theirs = await newOrder();
    historic = await newOrder();
    await assign(mine, rowA.id);
    await assign(historic, rowOff.id);
    await db.insert(ordenServicioFoto).values([
      { id: `scope-p-mine-${stamp}`, ordenId: mine, r2Key: "k1", position: 0 },
      { id: `scope-p-theirs-${stamp}`, ordenId: theirs, r2Key: "k2", position: 0 },
    ]);
  }, 60_000);

  afterAll(async () => {
    const orders = [mine, theirs, historic];
    await db.delete(ordenServicioFoto).where(inArray(ordenServicioFoto.ordenId, orders));
    await db.delete(ordenTecnico).where(inArray(ordenTecnico.ordenId, orders));
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(tecnico).where(inArray(tecnico.userId, madeUsers));
    await db.delete(users).where(inArray(users.id, madeUsers));
    await db.$client.end();
  });

  it("list: a técnico sees only the assigned order; an administrador sees all three", async () => {
    expect(ids(await listOrdenesServicio({}, page, orderScope(tecA)))).toEqual([mine]);
    expect(ids(await listOrdenesServicio({}, page, orderScope(admin)))).toEqual([historic, mine, theirs].sort());
  });

  it("count: the pager counts the same rows the list shows", async () => {
    expect(await countOrdenesServicio({}, orderScope(tecA))).toBe(1);
    expect(await countOrdenesServicio({}, orderScope(admin))).toBe(3);
  });

  it("detail: the assigned order loads, an unassigned one is null", async () => {
    expect((await getOrdenServicioById(mine, orderScope(tecA)))?.orden.id).toBe(mine);
    expect(await getOrdenServicioById(theirs, orderScope(tecA))).toBeNull();
    expect((await getOrdenServicioById(theirs, orderScope(admin)))?.orden.id).toBe(theirs);
  });

  it("photo GET lookup: the assigned order's photo resolves, an unassigned order's is null", async () => {
    const own = { ordenId: mine, photoId: `scope-p-mine-${stamp}` };
    const other = { ordenId: theirs, photoId: `scope-p-theirs-${stamp}` };
    expect(await findOrderPhoto(own, orderScope(tecA))).toEqual({ r2Key: "k1" });
    expect(await findOrderPhoto(other, orderScope(tecA))).toBeNull();
    expect(await findOrderPhoto(other, orderScope(admin))).toEqual({ r2Key: "k2" });
    expect(await listOrderPhotos(theirs, orderScope(tecA))).toEqual([]);
    expect(await listOrderPhotos(mine, orderScope(tecA))).toEqual([{ id: own.photoId }]);
  });

  it("customer orders: getClienteById returns the customer but only the assigned order's history", async () => {
    const asTecnico = await getClienteById(clienteId, orderScope(tecA));
    expect(asTecnico?.cliente.id).toBe(clienteId);
    expect(ids(asTecnico!.orders)).toEqual([mine]);
    expect(await getClienteById(clienteId, SYSTEM_SCOPE).then((d) => d!.orders)).toHaveLength(3);
  });

  it("vehicle history: only the assigned order", async () => {
    expect(ids(await listOrdenesByVehiculo(vehiculoId, orderScope(tecA)))).toEqual([mine]);
    expect(await listOrdenesByVehiculo(vehiculoId, orderScope(admin))).toHaveLength(3);
  });

  it("search 'perez' cannot reach an unassigned order, in the list or the count", async () => {
    expect(ids(await listOrdenesServicio({ search: "perez" }, page, orderScope(tecA)))).toEqual([mine]);
    expect(await countOrdenesServicio({ search: "perez" }, orderScope(tecA))).toBe(1);
    expect(await countOrdenesServicio({ search: "perez" }, orderScope(admin))).toBe(3);
  });

  it("a técnico login with no roster row sees nothing, anywhere", async () => {
    const scope = orderScope(tecNoRoster);
    expect(await listOrdenesServicio({}, page, scope)).toEqual([]);
    expect(await countOrdenesServicio({}, scope)).toBe(0);
    expect(await getOrdenServicioById(mine, scope)).toBeNull();
    expect((await getClienteById(clienteId, scope))!.orders).toEqual([]);
  });

  it("a DEACTIVATED roster row still sees the orders already assigned to it (and nobody else's)", async () => {
    expect(ids(await listOrdenesServicio({}, page, orderScope(tecOff)))).toEqual([historic]);
    expect(await getOrdenServicioById(historic, orderScope(tecOff))).not.toBeNull();
    expect(await getOrdenServicioById(mine, orderScope(tecOff))).toBeNull();
  });
});
