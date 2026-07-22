import Link from "next/link";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listAllCatalogs, listCatalogsForUser } from "@/modules/catalog-storage/queries";
import type { Catalog } from "@/shared/db/schema";

/**
 * R7 — catalog listing (name/date/categories). Per-user scope; Administrador
 * additionally sees every user's catalogs via the existing `catalogs.listAll`
 * policy action (defined by PR2's auth/policy.ts — this is its first real
 * caller). Preview/download both go through `/api/catalogs/[id]/file` (see
 * that route) so ownership + upload_status + R2 existence are checked in
 * exactly one place.
 */
export default async function CatalogsPage() {
  const user = await requireSessionFromHeaders();
  const catalogs = can(user, "catalogs.listAll") ? await listAllCatalogs() : await listCatalogsForUser(user.id);

  return (
    <main>
      <h1>My catalogs</h1>
      {catalogs.length === 0 ? (
        <p>
          No catalogs yet. <Link href="/builder">Build one</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Date</th>
              <th>Categories</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {catalogs.map((catalog) => (
              <CatalogRow key={catalog.id} catalog={catalog} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function CatalogRow({ catalog }: { catalog: Catalog }) {
  const categories = catalog.categories as { categoryL1: string; categoryL2: string | null }[];
  const categoryLabel = categories.map((c) => c.categoryL1).join(", ") || "—";

  return (
    <tr>
      <td>{catalog.title}</td>
      <td>{catalog.createdAt.toLocaleDateString()}</td>
      <td>{categoryLabel}</td>
      <td>{statusLabel(catalog.uploadStatus)}</td>
      <td>
        {catalog.uploadStatus === "uploaded" ? (
          <>
            <a href={`/api/catalogs/${catalog.id}/file`} target="_blank" rel="noreferrer">
              Preview
            </a>{" "}
            <a href={`/api/catalogs/${catalog.id}/file?download=1`}>Download</a>
          </>
        ) : catalog.uploadStatus === "failed" ? (
          // R7.5 — no persisted product selection to auto-replay (`categories`
          // is a display-only snapshot, see schema.ts's comment), so
          // "regenerate" is a link back to the builder, not an automatic
          // re-run. ponytail: revisit if a requirement asks to restore the
          // original selection instead of re-picking it.
          <Link href="/builder">Regenerate</Link>
        ) : (
          "Processing…"
        )}
      </td>
    </tr>
  );
}

function statusLabel(status: Catalog["uploadStatus"]): string {
  switch (status) {
    case "uploaded":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return "Processing";
  }
}
