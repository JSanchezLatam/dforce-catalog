import Link from "next/link";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listAllCatalogs, listCatalogsForUser } from "@/modules/catalog-storage/queries";
import type { Catalog } from "@/shared/db/schema";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CatalogsPolling } from "./CatalogsPolling";

const NON_TERMINAL = new Set(["pending", "uploading", "running"]);

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
  const hasActive = catalogs.some((c) => NON_TERMINAL.has(c.uploadStatus));

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>My catalogs</h1>
      <Card>
        <CardContent className="p-6">
        {catalogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No catalogs yet.{" "}
            <Link href="/builder" className="text-primary hover:underline">
              Build one
            </Link>
            .
          </p>
        ) : (
          <CatalogsPolling hasActive={hasActive}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogs.map((catalog) => (
                  <CatalogRow key={catalog.id} catalog={catalog} />
                ))}
              </TableBody>
            </Table>
          </CatalogsPolling>
        )}
        </CardContent>
      </Card>
    </div>
  );
}

function CatalogRow({ catalog }: { catalog: Catalog }) {
  const categories = catalog.categories as { categoryL1: string; categoryL2: string | null }[];
  const categoryLabel = categories.map((c) => c.categoryL1).join(", ") || "—";

  return (
    <TableRow>
      <TableCell>{catalog.title}</TableCell>
      <TableCell>{catalog.createdAt.toLocaleDateString()}</TableCell>
      <TableCell>{categoryLabel}</TableCell>
      <TableCell>
        <StatusBadge status={catalog.uploadStatus} label={statusLabel(catalog.uploadStatus)} />
      </TableCell>
      <TableCell className="space-x-2">
        {catalog.uploadStatus === "uploaded" ? (
          <>
            <a
              href={`/api/catalogs/${catalog.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Preview
            </a>
            <a href={`/api/catalogs/${catalog.id}/file?download=1`} className="text-primary hover:underline">
              Download
            </a>
          </>
        ) : catalog.uploadStatus === "failed" ? (
          // R7.5 — no persisted product selection to auto-replay (`categories`
          // is a display-only snapshot, see schema.ts's comment), so
          // "regenerate" is a link back to the builder, not an automatic
          // re-run. ponytail: revisit if a requirement asks to restore the
          // original selection instead of re-picking it.
          <Link href="/builder" className="text-primary hover:underline">
            Regenerate
          </Link>
        ) : (
          <span className="text-muted-foreground">Processing…</span>
        )}
      </TableCell>
    </TableRow>
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
