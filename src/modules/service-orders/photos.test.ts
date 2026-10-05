import { describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";
import { OrdenServicioNotFoundError } from "./service";
import {
  addOrderPhoto,
  deleteOrderPhoto,
  isJpeg,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  OrderClosedError,
  PhotoLimitError,
  PhotoNotFoundError,
} from "./photos";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("isJpeg", () => {
  it("accepts the JPEG signature", () => {
    expect(isJpeg(JPEG)).toBe(true);
  });

  it("rejects a PNG", () => {
    expect(isJpeg(PNG)).toBe(false);
  });

  it("rejects text that merely claims to be image/jpeg", () => {
    expect(isJpeg(Buffer.from("image/jpeg\n<html></html>"))).toBe(false);
  });

  it("rejects the SOI marker when no marker follows it", () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBe(false);
  });

  it("rejects a buffer too short to hold the signature", () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
});

describe("limits", () => {
  it("caps a photo at 3 MB and an order at 12 photos", () => {
    expect(MAX_PHOTO_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_PHOTOS).toBe(12);
  });
});

/**
 * A fake database that answers by STATEMENT ORDER, the way retention.test.ts
 * does: Drizzle's builder is not stringifiable, so the Nth awaited statement
 * gets the Nth queued result. `log` interleaves the statements with the R2
 * calls, which is what the ordering assertions read.
 */
function harness(opts: { results: unknown[][]; commitFails?: boolean; putFails?: boolean; deleteObjectFails?: boolean }) {
  const log: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const forArgs: unknown[] = [];
  let next = 0;

  const statement = (kind: string) => {
    log.push(kind);
    const chain: unknown = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          const result = opts.results[next++] ?? [];
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (prop === "for") forArgs.push(args[0]);
          if (prop === "values") inserted.push(args[0] as Record<string, unknown>);
          return chain;
        };
      },
    });
    return chain;
  };

  const tx = { select: () => statement("select"), insert: () => statement("insert"), delete: () => statement("delete") };
  const database = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
      const out = await fn(tx);
      if (opts.commitFails) throw new Error("commit failed");
      return out;
    },
  } as unknown as typeof db;

  const putObject = vi.fn(async (key: string) => {
    log.push("put");
    if (opts.putFails) throw new Error("r2 down");
    return key;
  });
  const deleteObject = vi.fn(async () => {
    log.push("deleteObject");
    if (opts.deleteObjectFails) throw new Error("r2 down");
  });

  return { deps: { db: database, putObject, deleteObject, newId: () => "photo-1" }, log, inserted, forArgs, putObject, deleteObject };
}

/** [order lock + status, count + next position] for `addOrderPhoto`. */
const orderAt = (status: string, count = 0, next = 0) => [[{ status }], [{ count, next }]];

describe("addOrderPhoto", () => {
  it("locks the order row, inserts the row, then puts the object, at the next position", async () => {
    const h = harness({ results: orderAt("open", 3, 7) });

    const photo = await addOrderPhoto({ ordenId: "ord-1", bytes: JPEG, createdBy: "user-1" }, h.deps);

    expect(photo).toEqual({ id: "photo-1", position: 7, r2Key: "service-orders/ord-1/photo-1.jpg" });
    expect(h.forArgs).toEqual(["update"]);
    expect(h.inserted).toEqual([
      { id: "photo-1", ordenId: "ord-1", r2Key: "service-orders/ord-1/photo-1.jpg", position: 7, createdBy: "user-1" },
    ]);
    expect(h.putObject).toHaveBeenCalledWith("service-orders/ord-1/photo-1.jpg", JPEG, "image/jpeg");
    expect(h.log).toEqual(["select", "select", "insert", "put"]);
  });

  it.each(["open", "in_progress"])("accepts a photo on a %s order", async (status) => {
    const h = harness({ results: orderAt(status) });
    await expect(addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps)).resolves.toMatchObject({ position: 0 });
  });

  it("refuses a 13th photo with PhotoLimitError and stores nothing", async () => {
    const h = harness({ results: orderAt("open", 12, 12) });

    const refused = addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps);

    await expect(refused).rejects.toBeInstanceOf(PhotoLimitError);
    await expect(refused).rejects.toThrow("La orden ya tiene 12 fotos");
    expect(h.inserted).toEqual([]);
    expect(h.putObject).not.toHaveBeenCalled();
  });

  it("still accepts the 12th photo (11 stored)", async () => {
    const h = harness({ results: orderAt("open", 11, 11) });
    await expect(addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps)).resolves.toMatchObject({ position: 11 });
  });

  it.each(["done", "cancelled"])("refuses a %s order with OrderClosedError, before counting or storing", async (status) => {
    const h = harness({ results: orderAt(status) });

    const refused = addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps);

    await expect(refused).rejects.toBeInstanceOf(OrderClosedError);
    await expect(refused).rejects.toThrow("La orden está cerrada");
    expect(h.log).toEqual(["select"]);
    expect(h.putObject).not.toHaveBeenCalled();
  });

  it("throws OrdenServicioNotFoundError for an order that does not exist", async () => {
    const h = harness({ results: [[]] });
    await expect(addOrderPhoto({ ordenId: "nope", bytes: JPEG }, h.deps)).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
    expect(h.putObject).not.toHaveBeenCalled();
  });

  it("propagates a throwing put and never calls deleteObject (the transaction rolls the row back)", async () => {
    const h = harness({ results: orderAt("open"), putFails: true });

    await expect(addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps)).rejects.toThrow("r2 down");

    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the object when the commit fails after the put, and rethrows", async () => {
    const h = harness({ results: orderAt("open"), commitFails: true });

    await expect(addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps)).rejects.toThrow("commit failed");

    expect(h.deleteObject).toHaveBeenCalledWith("service-orders/ord-1/photo-1.jpg");
    expect(h.log.at(-1)).toBe("deleteObject");
  });

  it("rethrows the commit failure even when the cleanup delete also fails", async () => {
    const h = harness({ results: orderAt("open"), commitFails: true, deleteObjectFails: true });
    await expect(addOrderPhoto({ ordenId: "ord-1", bytes: JPEG }, h.deps)).rejects.toThrow("commit failed");
  });
});

describe("deleteOrderPhoto", () => {
  /** [order lock + status, DELETE … RETURNING r2_key] */
  const lockedThenDeleted = (status: string, returned: unknown[]) => [[{ status }], returned];

  it("locks and gates the order, deletes the row, and only then deletes the object", async () => {
    const h = harness({ results: lockedThenDeleted("in_progress", [{ r2Key: "service-orders/ord-1/photo-1.jpg" }]) });

    await deleteOrderPhoto({ ordenId: "ord-1", photoId: "photo-1" }, h.deps);

    expect(h.forArgs).toEqual(["update"]);
    expect(h.deleteObject).toHaveBeenCalledWith("service-orders/ord-1/photo-1.jpg");
    expect(h.log).toEqual(["select", "delete", "deleteObject"]);
  });

  it.each(["done", "cancelled"])("refuses a %s order and deletes neither the row nor the object", async (status) => {
    const h = harness({ results: lockedThenDeleted(status, [{ r2Key: "k" }]) });

    await expect(deleteOrderPhoto({ ordenId: "ord-1", photoId: "photo-1" }, h.deps)).rejects.toBeInstanceOf(OrderClosedError);

    expect(h.log).toEqual(["select"]);
    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("throws PhotoNotFoundError when no row matches (photoId, ordenId) and touches no object", async () => {
    const h = harness({ results: lockedThenDeleted("open", []) });

    await expect(deleteOrderPhoto({ ordenId: "ord-1", photoId: "other" }, h.deps)).rejects.toBeInstanceOf(PhotoNotFoundError);

    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("throws OrdenServicioNotFoundError for a missing order", async () => {
    const h = harness({ results: [[]] });
    await expect(deleteOrderPhoto({ ordenId: "nope", photoId: "p" }, h.deps)).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
  });

  it("swallows an object-delete failure: the row is already gone and the delete succeeded", async () => {
    const h = harness({ results: lockedThenDeleted("open", [{ r2Key: "k" }]), deleteObjectFails: true });
    await expect(deleteOrderPhoto({ ordenId: "ord-1", photoId: "photo-1" }, h.deps)).resolves.toBeUndefined();
    expect(h.deleteObject).toHaveBeenCalledTimes(1);
  });
});
