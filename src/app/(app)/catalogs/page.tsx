import Link from "next/link";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listAllCatalogs, listCatalogsForUser } from "@/modules/catalog-storage/queries";
import type { Catalog } from "@/shared/db/schema";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { CARD, PAGE_HEADING, TABLE_TD, TABLE_TH } from "@/shared/ui/styles";

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
    <main className="p-8">
      <h1 className={PAGE_HEADING}>My catalogs</h1>
      <div className={CARD}>
        {catalogs.length === 0 ? (
          <p className="text-sm text-dash-fg">
            No catalogs yet.{" "}
            <Link href="/builder" className="text-dash-purple hover:underline">
              Build one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-dash-muted/40">
            <table className="w-full border-collapse">
              <thead className="bg-dash-card">
                <tr>
                  <th className={TABLE_TH}>Name</th>
                  <th className={TABLE_TH}>Date</th>
                  <th className={TABLE_TH}>Categories</th>
                  <th className={TABLE_TH}>Status</th>
                  <th className={TABLE_TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {catalogs.map((catalog) => (
                  <CatalogRow key={catalog.id} catalog={catalog} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function CatalogRow({ catalog }: { catalog: Catalog }) {
  const categories = catalog.categories as { categoryL1: string; categoryL2: string | null }[];
  const categoryLabel = categories.map((c) => c.categoryL1).join(", ") || "—";

  return (
    <tr className="border-t border-dash-muted/20">
      <td className={TABLE_TD}>{catalog.title}</td>
      <td className={TABLE_TD}>{catalog.createdAt.toLocaleDateString()}</td>
      <td className={TABLE_TD}>{categoryLabel}</td>
      <td className={TABLE_TD}>
        <StatusBadge status={catalog.uploadStatus} label={statusLabel(catalog.uploadStatus)} />
      </td>
      <td className={`${TABLE_TD} space-x-2`}>
        {catalog.uploadStatus === "uploaded" ? (
          <>
            <a
              href={`/api/catalogs/${catalog.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="text-dash-purple hover:underline"
            >
              Preview
            </a>
            <a href={`/api/catalogs/${catalog.id}/file?download=1`} className="text-dash-purple hover:underline">
              Download
            </a>
          </>
        ) : catalog.uploadStatus === "failed" ? (
          // R7.5 — no persisted product selection to auto-replay (`categories`
          // is a display-only snapshot, see schema.ts's comment), so
          // "regenerate" is a link back to the builder, not an automatic
          // re-run. ponytail: revisit if a requirement asks to restore the
          // original selection instead of re-picking it.
          <Link href="/builder" className="text-dash-purple hover:underline">
            Regenerate
          </Link>
        ) : (
          <span className="text-dash-muted">Processing…</span>
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
