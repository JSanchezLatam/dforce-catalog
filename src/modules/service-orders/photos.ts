/**
 * service-orders/photos.ts — reception photos (service-order-reception).
 *
 * Every write takes `SELECT … FOR UPDATE` on the parent `orden_servicio` row
 * first (`lockOrderForMutation`). A closed order is writable only with an
 * administrator `CorrectionGrant`, and then the change gets one `foto` audit row
 * `(null, photoId)` for an add, `(photoId, null)` for a delete, in the same
 * transaction, so a failed put or commit rolls it back with the photo row.
 *
 * That one lock does three jobs: it serializes concurrent uploads to the
 * same order (so the 12-photo cap and `position` cannot race), it makes the
 * status gate and the write one atomic step (`transitionOrder`'s UPDATE waits
 * on the same lock, so an order cannot close between the gate and the insert),
 * and it needs no hash or advisory-lock key. A CHECK cannot count rows.
 *
 * R2 ordering, both ways chosen so the only possible orphan is an INVISIBLE one
 * (an object nobody references) and never a row pointing at nothing:
 * - add: insert the row, then put the object INSIDE the transaction. A throwing
 *   put rolls the row back. Only a failed commit after a good put leaves an
 *   object, and that path deletes it.
 * - delete: delete the row, commit, then delete the object, swallowing failure.
 *
 * ponytail: no orphan sweeper. An object left by a failed cleanup is harmless;
 * add a sweeper by `service-orders/` prefix only if the bucket ever matters.
 *
 * Callers own the byte check (`isJpeg`, `MAX_PHOTO_BYTES`) and the role check
 * (`service-orders.deletePhoto`); this module owns the order-scoped invariants.
 */
import { and, asc, count, eq, sql } from "drizzle-orm";

import { deleteObject, putObject } from "@/modules/catalog-storage/r2";
import { db } from "@/shared/db/client";
import { ordenServicioFoto } from "@/shared/db/schema";
import { canChangeOrderPhotos } from "./edit-policy";
import { lockOrderForMutation, OrderClosedError, recordCorrections, type CorrectionGrant } from "./order-lock";
import { MAX_PHOTOS } from "./photo-limits";

export { MAX_PHOTOS, OrderClosedError };
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** Leading bytes of every JPEG: SOI marker `FF D8` followed by a marker `FF`. The declared content type is never trusted. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export class PhotoLimitError extends Error {
  constructor() {
    super(`La orden ya tiene ${MAX_PHOTOS} fotos`);
  }
}

export class PhotoNotFoundError extends Error {
  constructor() {
    super("La foto no existe en esta orden");
  }
}

export type PhotoDeps = {
  db?: typeof db;
  putObject?: typeof putObject;
  deleteObject?: typeof deleteObject;
  newId?: () => string;
};

export async function addOrderPhoto(
  input: { ordenId: string; bytes: Buffer; createdBy?: string | null; correction?: CorrectionGrant },
  deps: PhotoDeps = {},
): Promise<{ id: string; position: number; r2Key: string }> {
  const database = deps.db ?? db;
  const put = deps.putObject ?? putObject;
  const remove = deps.deleteObject ?? deleteObject;
  // Server-side on purpose: `crypto.randomUUID` does not exist in the browser over LAN HTTP.
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const r2Key = `service-orders/${input.ordenId}/${id}.jpg`;
  let stored = false;

  try {
    return await database.transaction(async (tx) => {
      const { correcting } = await lockOrderForMutation(tx, input.ordenId, {
        canWrite: canChangeOrderPhotos,
        correction: input.correction,
      });

      const [{ count: total, next }] = await tx
        .select({
          count: count(),
          next: sql<number>`coalesce(max(${ordenServicioFoto.position}) + 1, 0)`.mapWith(Number),
        })
        .from(ordenServicioFoto)
        .where(eq(ordenServicioFoto.ordenId, input.ordenId));
      if (total >= MAX_PHOTOS) throw new PhotoLimitError();

      await tx
        .insert(ordenServicioFoto)
        .values({ id, ordenId: input.ordenId, r2Key, position: next, createdBy: input.createdBy ?? null });
      if (correcting && input.correction) {
        await recordCorrections(tx, {
          ordenId: input.ordenId,
          userId: input.correction.correctorId,
          before: { foto: null },
          after: { foto: id },
        });
      }
      await put(r2Key, input.bytes, "image/jpeg");
      stored = true;

      return { id, position: next, r2Key };
    });
  } catch (err) {
    // The put succeeded but the commit did not: the object is now unreferenced.
    if (stored) await remove(r2Key).catch(() => {});
    throw err;
  }
}

/** The order's photos in display order (position ascends; gaps after a delete are fine). */
export async function listOrderPhotos(
  ordenId: string,
  deps: Pick<PhotoDeps, "db"> = {},
): Promise<{ id: string }[]> {
  return (deps.db ?? db)
    .select({ id: ordenServicioFoto.id })
    .from(ordenServicioFoto)
    .where(eq(ordenServicioFoto.ordenId, ordenId))
    .orderBy(asc(ordenServicioFoto.position));
}

/** Scoped by BOTH ids: a photo id from another order is "not found", never a cross-order read. */
export async function findOrderPhoto(
  input: { ordenId: string; photoId: string },
  deps: Pick<PhotoDeps, "db"> = {},
): Promise<{ r2Key: string } | null> {
  const [row] = await (deps.db ?? db)
    .select({ r2Key: ordenServicioFoto.r2Key })
    .from(ordenServicioFoto)
    .where(and(eq(ordenServicioFoto.id, input.photoId), eq(ordenServicioFoto.ordenId, input.ordenId)));
  return row ?? null;
}

export async function deleteOrderPhoto(
  input: { ordenId: string; photoId: string; correction?: CorrectionGrant },
  deps: PhotoDeps = {},
): Promise<void> {
  const database = deps.db ?? db;
  const remove = deps.deleteObject ?? deleteObject;

  const r2Key = await database.transaction(async (tx) => {
    const { correcting } = await lockOrderForMutation(tx, input.ordenId, {
      canWrite: canChangeOrderPhotos,
      correction: input.correction,
    });
    const [row] = await tx
      .delete(ordenServicioFoto)
      .where(and(eq(ordenServicioFoto.id, input.photoId), eq(ordenServicioFoto.ordenId, input.ordenId)))
      .returning({ r2Key: ordenServicioFoto.r2Key });
    if (!row) throw new PhotoNotFoundError();
    if (correcting && input.correction) {
      await recordCorrections(tx, {
        ordenId: input.ordenId,
        userId: input.correction.correctorId,
        before: { foto: input.photoId },
        after: { foto: null },
      });
    }
    return row.r2Key;
  });

  // After the commit: a missing object is invisible, a row without one is a broken image.
  await remove(r2Key).catch(() => {});
}
