import { CatalogBuilderForm } from "@/modules/catalog-builder/CatalogBuilderForm";
import { listCategoryPairs } from "@/modules/catalog-builder/queries";
import { countUploadedCatalogsForUser } from "@/modules/catalog-storage/queries";
import { can } from "@/modules/auth/policy";
import { listCategoryL1Options } from "@/modules/inventory-view/queries";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getTemplateConfig } from "@/modules/template-config/service";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { PAGE_HEADING } from "@/shared/ui/styles";

/**
 * R5 — catalog builder: category/product selection with a live title/index
 * preview (Risk-5's shared `CatalogTemplate`). Building a catalog is
 * admin-only (`catalogs.generate` in the permission matrix, checked three
 * lines below) — this page is NOT open to every authenticated user; the
 * denial branch below is the actual gate, not just `proxy.ts`'s session
 * check.
 *
 * `force-dynamic`: unlike `/inventory` (reads `searchParams`) or
 * `/template-config` (reads `headers()`), this page uses no dynamic Next.js
 * API, so Next would otherwise statically prerender it at build time and
 * bake in whatever category options/template config existed then — stale
 * the moment inventory or branding change post-deploy.
 */
export const dynamic = "force-dynamic";

export default async function CatalogBuilderPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "catalogs.generate")) {
    return <div className="p-8"><p className="text-sm text-foreground">No tienes permiso para ver esta página.</p></div>;
  }

  const [categoryL1Options, categoryPairs, templateConfig, workshopConfig] = await Promise.all([
    listCategoryL1Options(),
    listCategoryPairs(),
    getTemplateConfig(),
    getWorkshopConfig(),
  ]);

  const catalogCount = await countUploadedCatalogsForUser(user.id);

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Generar catálogo</h1>
      <CatalogBuilderForm
        categoryL1Options={categoryL1Options}
        categoryPairs={categoryPairs}
        templateConfig={templateConfig}
        workshopConfig={workshopConfig}
        catalogCount={catalogCount}
      />
    </div>
  );
}
