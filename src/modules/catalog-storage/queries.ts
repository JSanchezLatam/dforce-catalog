/**
 * catalog-storage — DB reads/writes for the `catalogs` table (R7 listing,
 * Risk-1 row creation). No DI here (unlike upload-status.ts/retention.ts) —
 * these are plain reads/one insert, same convention as
 * inventory-view/queries.ts and catalog-builder/queries.ts (DB-integration
 * tests deferred to the Postgres-testcontainer gap flagged since PR2/PR3).
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { catalogs, type Catalog } from "@/shared/db/schema";
import type { PdfGeneratePayload } from "../pdf-generation/enqueue";

/**
 * Risk-1 — inserted by pdf-generation/worker.ts right after render+handoff,
 * BEFORE the `pdf-upload` job is even sent, so a crash at any later point
 * still leaves a visible row instead of a silently orphaned temp file (see
 * upload-status.ts's header comment). This also resolves PR7's "PR8 MUST"
 * handoff gap: `title`/`categories` come from the SAME `pdf-generate`
 * payload the worker already has in hand — no `pdf-upload` payload change
 * was needed.
 */
export async function createPendingCatalog(payload: PdfGeneratePayload): Promise<void> {
  await db.insert(catalogs).values({
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

/** R7.1 — Administrador sees every user's catalogs (caller must already have checked `can(user, "catalogs.listAll")`). */
export async function listAllCatalogs(): Promise<Catalog[]> {
  return db.select().from(catalogs).orderBy(desc(catalogs.createdAt));
}

export async function getCatalogById(id: string): Promise<Catalog | undefined> {
  const rows = await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1);
  return rows[0];
}
