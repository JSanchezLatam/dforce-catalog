/**
 * catalog-storage — DB reads/writes for the `catalogs` table (R7 listing,
 * Risk-1 row creation). No DI here (unlike upload-status.ts/retention.ts) —
 * these are plain reads/one insert, same convention as
 * inventory-view/queries.ts and catalog-builder/queries.ts (DB-integration
 * tests deferred to the Postgres-testcontainer gap flagged since PR2/PR3).
 */
import { and, count, desc, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { catalogs, type Catalog } from "@/shared/db/schema";
import type { PdfGeneratePayload } from "../pdf-generation/enqueue";

/**
 * Risk-1 — inserted by pdf-generation/enqueue.ts inside the same advisory-
 * locked transaction that sends the `pdf-generate` job (`executor` is that
 * transaction), so the row exists from the moment Generar returns: /catalogs
 * shows it `pending`, and a render that fails for good has a row to mark
 * `failed`. It used to be inserted by the worker AFTER the render, which hid
 * the catalog while it rendered and left a failed render with no row at all.
 * `title`/`categories` come from the `pdf-generate` payload itself, so the
 * `pdf-upload` payload still needs no `title`.
 */
export async function createPendingCatalog(
  payload: PdfGeneratePayload,
  executor: { insert: typeof db.insert } = db,
): Promise<void> {
  await executor.insert(catalogs).values({
    id: payload.catalogId,
    userId: payload.userId,
    title: payload.title,
    categories: payload.sections.map(({ categoryL1, categoryL2 }) => ({ categoryL1, categoryL2 })),
    productsPerPage: payload.productsPerPage,
    uploadStatus: "pending",
  });
}

/** R7.1 — a user's own catalogs, newest first. */
export async function listCatalogsForUser(userId: string): Promise<Catalog[]> {
  return db.select().from(catalogs).where(eq(catalogs.userId, userId)).orderBy(desc(catalogs.createdAt));
}

/** Every catalog, whoever generated it — a catalog is a workshop asset, not a
 * personal document (2026-09-15). Both roles hold `catalogs.listAll` now; the
 * caller must already have checked it. */
export async function listAllCatalogs(): Promise<Catalog[]> {
  return db.select().from(catalogs).orderBy(desc(catalogs.createdAt));
}

export async function getCatalogById(id: string): Promise<Catalog | undefined> {
  const rows = await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1);
  return rows[0];
}

/** R11.3 — feeds `retention.ts`'s `shouldWarnOfEviction` predicate at generate-request time. */
export async function countUploadedCatalogsForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(catalogs)
    .where(and(eq(catalogs.userId, userId), eq(catalogs.uploadStatus, "uploaded")));
  return rows[0]?.value ?? 0;
}
