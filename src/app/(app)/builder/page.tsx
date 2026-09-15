import { CatalogBuilderForm } from "@/modules/catalog-builder/CatalogBuilderForm";
import { listCategoryPairs } from "@/modules/catalog-builder/queries";
import { parseSeedProductIds } from "@/modules/catalog-builder/selection";
import { countUploadedCatalogsForUser } from "@/modules/catalog-storage/queries";
import { can } from "@/modules/auth/policy";
import { listCategoryL1Options } from "@/modules/inventory-view/queries";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { PAGE_HEADING } from "@/shared/ui/styles";

/**
 * R5 — catalog builder: category/product selection. The live title/index
 * preview this page used to carry moved to `/template-config`
 * (workshop-feedback-round-1 PR F1): it could never show a product, and at
 * full print size it buried the controls. Building a catalog is
 * admin-only (`catalogs.generate` in the permission matrix, checked three
 * lines below) — this page is NOT open to every authenticated user; the
 * denial branch below is the actual gate, not just `proxy.ts`'s session
 * check.
 *
 * `force-dynamic`: this page now reads `searchParams` (the `/inventory`
 * handoff below), which already forces a request-time render — but the
 * directive stays, because what must never be prerendered here is the
 * category options, and those are just as stale on a visit with NO query
 * string. Without it Next would bake in whatever existed at build time and
 * serve it after inventory changed.
 */
export const dynamic = "force-dynamic";

export default async function CatalogBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  /**
   * D10 — `/inventory`'s selection bar navigates here with `?products=a,b,c`.
   * `parseSeedProductIds` re-applies the 200 cap server-side: the bar's own
   * refusal runs in the browser, and this URL is hand-editable. Only the ids
   * cross into the client component — a plain `string[]`, and the builder
   * resolves each id's current product data itself (spec: the handoff carries
   * ids and nothing else).
   */
  const seedProductIds = parseSeedProductIds(params.products);
  const user = await requireSessionFromHeaders();
  if (!can(user, "catalogs.generate")) {
    return <div className="p-8"><p className="text-sm text-foreground">No tenés permiso para ver esta página.</p></div>;
  }

  const [categoryL1Options, categoryPairs] = await Promise.all([
    listCategoryL1Options(),
    listCategoryPairs(),
  ]);

  const catalogCount = await countUploadedCatalogsForUser(user.id);

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Generar catálogo</h1>
      <CatalogBuilderForm
        categoryL1Options={categoryL1Options}
        categoryPairs={categoryPairs}
        catalogCount={catalogCount}
        seedProductIds={seedProductIds}
      />
    </div>
  );
}
