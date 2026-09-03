"use client";

import { Eye, Download, Printer } from "lucide-react";

import { formatDate } from "@/shared/datetime";
import type { Catalog } from "@/shared/db/schema";
import { StatusBadge, type BadgeStatus } from "@/shared/ui/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const GRADIENTS = [
  "from-violet-600 to-indigo-600",
  "from-emerald-600 to-teal-600",
  "from-orange-600 to-rose-600",
  "from-sky-600 to-cyan-600",
  "from-pink-600 to-purple-600",
  "from-amber-600 to-red-600",
  "from-teal-600 to-green-600",
  "from-blue-600 to-violet-600",
];

function statusLabel(status: Catalog["uploadStatus"]): string {
  switch (status) {
    case "uploaded":
      return "Listo";
    case "failed":
      return "Fallido";
    default:
      return "Procesando";
  }
}

export function CatalogGrid({ initialCatalogs }: { initialCatalogs: Catalog[] }) {
  if (initialCatalogs.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {initialCatalogs.map((catalog, i) => (
        <CatalogCard key={catalog.id} catalog={catalog} gradient={GRADIENTS[i % GRADIENTS.length]} />
      ))}
    </div>
  );
}

function CatalogCard({ catalog, gradient }: { catalog: Catalog; gradient: string }) {
  const categories = catalog.categories as { categoryL1: string; categoryL2: string | null }[];
  const l1Set = new Set(categories.map((c) => c.categoryL1).filter(Boolean));
  const l2Set = new Set(categories.map((c) => c.categoryL2).filter((v): v is string => v !== null));

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className={`flex h-32 items-end bg-gradient-to-br ${gradient} p-4`}>
        <h3 className="text-lg font-bold text-white drop-shadow-sm">{catalog.title}</h3>
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{formatDate(catalog.createdAt)}</span>
          <StatusBadge status={catalog.uploadStatus as BadgeStatus} label={statusLabel(catalog.uploadStatus)} />
        </div>

        {(l1Set.size > 0 || l2Set.size > 0) && (
          <div className="flex flex-wrap gap-1">
            {[...l1Set].map((cat) => (
              <Badge key={cat} variant="secondary">
                {cat}
              </Badge>
            ))}
            {[...l2Set].map((cat) => (
              <Badge key={cat} variant="outline" className="text-muted-foreground">
                {cat}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          {catalog.uploadStatus === "uploaded" ? (
            <>
              <a
                href={`/api/catalogs/${catalog.id}/file`}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Eye />
                Vista previa
              </a>
              <a
                href={`/api/catalogs/${catalog.id}/file?download=1`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Download />
                Descargar
              </a>
              <a
                href={`/api/catalogs/${catalog.id}/file`}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline" }), "col-span-2")}
              >
                <Printer />
                Imprimir
              </a>
            </>
          ) : catalog.uploadStatus === "failed" ? (
            <a href="/builder" className={cn(buttonVariants({ variant: "outline" }), "col-span-2")}>
              Regenerar
            </a>
          ) : (
            <span className="col-span-2 text-sm text-muted-foreground">Procesando…</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
