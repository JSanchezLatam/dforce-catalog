import Link from "next/link";
import { FolderOpen } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listAllCatalogs, listCatalogsForUser } from "@/modules/catalog-storage/queries";
import { CatalogPollProvider } from "@/modules/catalog-storage/CatalogPollProvider";
import { CatalogGrid } from "@/modules/catalog-storage/CatalogGrid";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";

export default async function CatalogsPage() {
  const user = await requireSessionFromHeaders();
  const catalogs = can(user, "catalogs.listAll") ? await listAllCatalogs() : await listCatalogsForUser(user.id);

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Mis catálogos</h1>
      <Card>
        <CardContent className="p-6">
        {catalogs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FolderOpen className="size-10 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">No hay catálogos aún</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Todavía no creaste ningún catálogo. Generá el primero para verlo listado acá.
            </p>
            <Link href="/builder" className="text-sm text-primary hover:underline">
              Crear catálogo
            </Link>
          </div>
        ) : (
          <CatalogPollProvider initialCatalogs={catalogs}>
            <CatalogGrid initialCatalogs={catalogs} />
          </CatalogPollProvider>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
