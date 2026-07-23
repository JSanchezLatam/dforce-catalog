import { CatalogBuilderForm } from "@/modules/catalog-builder/CatalogBuilderForm";
import { listCategoryPairs } from "@/modules/catalog-builder/queries";
import { countUploadedCatalogsForUser } from "@/modules/catalog-storage/queries";
import { listCategoryL1Options } from "@/modules/inventory-view/queries";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getTemplateConfig } from "@/modules/template-config/service";
import { PAGE_HEADING } from "@/shared/ui/styles";

/**
 * R5 — catalog builder: category/product selection with a live title/index
 * preview (Risk-5's shared `CatalogTemplate`). Any authenticated user may
 * build a catalog — not in the admin-only `can()` list — so `proxy.ts`'s
 * blanket session guard is the only auth check this page needs, same as
 * `inventory-view`'s page.
 *
 * `force-dynamic`: unlike `/inventory` (reads `searchParams`) or
 * `/template-config` (reads `headers()`), this page uses no dynamic Next.js
 * API, so Next would otherwise statically prerender it at build time and
 * bake in whatever category options/template config existed then — stale
 * the moment inventory or branding change post-deploy.
 */
export const dynamic = "force-dynamic";

export default async function CatalogBuilderPage() {
  const [user, categoryL1Options, categoryPairs, templateConfig] = await Promise.all([
    requireSessionFromHeaders(),
    listCategoryL1Options(),
    listCategoryPairs(),
    getTemplateConfig(),
  ]);

  const catalogCount = await countUploadedCatalogsForUser(user.id);

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Build a catalog</h1>
      <CatalogBuilderForm
        categoryL1Options={categoryL1Options}
        categoryPairs={categoryPairs}
        templateConfig={templateConfig}
        catalogCount={catalogCount}
      />
    </div>
  );
}
