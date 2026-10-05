/**
 * Real-SQL proof for service-order-reception WU3a (reception photos). The unit
 * tests answer by statement order, so they prove the sequence of calls and
 * nothing about Postgres: not the `FOR UPDATE`, not the unique index, not the
 * cascade. They do here, against a THROWAWAY database (`dforce_e2e`, see
 * README "Running the E2E test") — never the dev one. R2 is injected: no test
 * here touches the real bucket.
 */
import { execSync } from "node:child_process";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/shared/db/client";
import { catalogs, cliente, ordenServicio, ordenServicioFoto, users, vehiculo } from "@/shared/db/schema";
import { runRetentionForUser } from "../modules/catalog-storage/retention";
import { addOrderPhoto, deleteOrderPhoto, MAX_PHOTOS, OrderClosedError, PhotoLimitError, type PhotoDeps } from "../modules/service-orders/photos";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("orden_servicio_foto (E2E)", () => {
  let userId: string;
  let clienteId: string;
  let vehiculoId: string;
  let r2: { put: string[]; deleted: string[] };

  /**
   * A put that takes a few ms, so that without the row lock the concurrent
   * transactions genuinely overlap instead of finishing one by one by luck.
   */
  const deps = (over: Partial<PhotoDeps> = {}): PhotoDeps => ({
    putObject: async (key) => {
      await sleep(5);
      r2.put.push(key);
      return key;
    },
    deleteObject: async (key) => {
      r2.deleted.push(key);
    },
    ...over,
  });

  const newOrder = async (status: "open" | "in_progress" | "done" | "cancelled" = "open") => {
    const [row] = await db
      .insert(ordenServicio)
      .values({ clienteId, vehiculoId, categoria: "revisado", status })
      .returning({ id: ordenServicio.id });
    return row.id;
  };
  const rows = (ordenId: string) =>
    db.select().from(ordenServicioFoto).where(eq(ordenServicioFoto.ordenId, ordenId)).orderBy(asc(ordenServicioFoto.position));

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    const [user] = await db
      .insert(users)
      .values({ username: `e2e-photos-${Date.now()}`, passwordHash: "x", role: "administrador" })
      .returning({ id: users.id });
    userId = user.id;
    const [c] = await db.insert(cliente).values({ name: "E2E Photos", phone: "50769993001" }).returning({ id: cliente.id });
    clienteId = c.id;
    const [v] = await db.insert(vehiculo).values({ clienteId, plate: "PHO001", motor: "combustion" }).returning({ id: vehiculo.id });
    vehiculoId = v.id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(ordenServicio).where(eq(ordenServicio.clienteId, clienteId));
    await db.delete(vehiculo).where(eq(vehiculo.clienteId, clienteId));
    await db.delete(cliente).where(eq(cliente.id, clienteId));
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  });

  const reset = () => {
    r2 = { put: [], deleted: [] };
  };

  it("13 concurrent addOrderPhoto leave exactly 12 rows and exactly one PhotoLimitError", async () => {
    reset();
    const ordenId = await newOrder();

    const results = await Promise.allSettled(
      Array.from({ length: MAX_PHOTOS + 1 }, () => addOrderPhoto({ ordenId, bytes: JPEG, createdBy: userId }, deps())),
    );

    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(PhotoLimitError);
    const stored = await rows(ordenId);
    expect(stored).toHaveLength(MAX_PHOTOS);
    expect(stored.map((r) => r.position)).toEqual(Array.from({ length: MAX_PHOTOS }, (_, i) => i));
    expect(r2.put).toHaveLength(MAX_PHOTOS);
  });

  it("assigns ascending positions, and a delete leaves a gap that the next add does not reuse", async () => {
    reset();
    const ordenId = await newOrder("in_progress");
    const a = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    const b = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    const c = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    await deleteOrderPhoto({ ordenId, photoId: b.id }, deps());
    const d = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());

    expect((await rows(ordenId)).map((r) => r.id)).toEqual([a.id, c.id, d.id]);
    expect(d.position).toBe(3);
    expect(r2.deleted).toEqual([b.r2Key]);
  });

  it("a throwing put rolls the row back: 0 rows, and no object delete attempted", async () => {
    reset();
    const ordenId = await newOrder();

    await expect(
      addOrderPhoto({ ordenId, bytes: JPEG }, deps({ putObject: async () => Promise.reject(new Error("r2 down")) })),
    ).rejects.toThrow("r2 down");

    expect(await rows(ordenId)).toHaveLength(0);
    expect(r2.deleted).toEqual([]);
  });

  it.each(["done", "cancelled"] as const)("add on a %s order is refused and stores nothing", async (status) => {
    reset();
    const ordenId = await newOrder(status);

    await expect(addOrderPhoto({ ordenId, bytes: JPEG }, deps())).rejects.toBeInstanceOf(OrderClosedError);

    expect(await rows(ordenId)).toHaveLength(0);
    expect(r2.put).toEqual([]);
  });

  it("delete on a done order is refused: the row and the object stay", async () => {
    reset();
    const ordenId = await newOrder("open");
    const photo = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    await db.update(ordenServicio).set({ status: "done" }).where(eq(ordenServicio.id, ordenId));

    await expect(deleteOrderPhoto({ ordenId, photoId: photo.id }, deps())).rejects.toBeInstanceOf(OrderClosedError);

    expect(await rows(ordenId)).toHaveLength(1);
    expect(r2.deleted).toEqual([]);
  });

  it("delete is scoped by order: another order's photo id deletes nothing", async () => {
    reset();
    const ordenId = await newOrder();
    const other = await newOrder();
    const photo = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());

    await expect(deleteOrderPhoto({ ordenId: other, photoId: photo.id }, deps())).rejects.toThrow("La foto no existe");

    expect(await rows(ordenId)).toHaveLength(1);
  });

  it("two photos of one order cannot share a position (unique index)", async () => {
    const ordenId = await newOrder();
    const photo = await addOrderPhoto({ ordenId, bytes: JPEG }, deps());

    await expect(
      db.insert(ordenServicioFoto).values({ id: "dup", ordenId, r2Key: "k", position: photo.position }),
    ).rejects.toMatchObject({ cause: { code: "23505", constraint: "orden_servicio_foto_orden_position_idx" } });
  });

  it("deleting the order cascades to its photos", async () => {
    reset();
    const ordenId = await newOrder();
    await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    expect(await rows(ordenId)).toHaveLength(2);

    await db.delete(ordenServicio).where(eq(ordenServicio.id, ordenId));

    expect(await rows(ordenId)).toHaveLength(0);
  });

  it("a retention run evicts the surplus catalog and deletes nothing under service-orders/", async () => {
    reset();
    const ordenId = await newOrder();
    await addOrderPhoto({ ordenId, bytes: JPEG }, deps());
    const ids = ["old", "mid", "new"].map((n) => `e2e-photos-cat-${n}-${Date.now()}`);
    for (const [i, id] of ids.entries()) {
      await db.insert(catalogs).values({
        id,
        userId,
        title: id,
        categories: [],
        productsPerPage: 6,
        uploadStatus: "uploaded",
        r2Key: `catalogs/${id}.pdf`,
        createdAt: new Date(Date.now() - (ids.length - i) * 60_000),
      });
    }
    const deleted: string[] = [];

    try {
      const { evictedIds } = await runRetentionForUser(userId, { deleteObject: async (key) => void deleted.push(key) });

      // The catalog arm ran for real (one evicted), so an empty photo arm is not a vacuous pass.
      expect(evictedIds).toEqual([ids[0]]);
      expect(deleted).toEqual([`catalogs/${ids[0]}.pdf`]);
      expect(deleted.filter((key) => key.startsWith("service-orders/"))).toEqual([]);
      expect(await rows(ordenId)).toHaveLength(1);
    } finally {
      await db.delete(catalogs).where(eq(catalogs.userId, userId));
    }
  });
});
