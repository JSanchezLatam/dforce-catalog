"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LazyImage } from "@/shared/ui/LazyImage";
import { SECTION_HEADING, CARD } from "@/shared/ui/styles";
import type { ProductRef } from "./selection";

const IMAGE_TYPE_LABELS: Record<string, string> = {
  transparent: "Transparente",
  opaque: "Opaca",
  low_res: "Baja res.",
};

const IMAGE_TYPE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  transparent: "default",
  opaque: "secondary",
  low_res: "destructive",
};

export function ProductLayoutTuner({
  products,
  overrides,
  bulkFramed,
  onOverride,
  onBulkFrame,
}: {
  products: ProductRef[];
  overrides: Record<string, "transparent" | "opaque" | "low_res" | null>;
  bulkFramed: boolean;
  onOverride: (id: string, value: "transparent" | "opaque" | "low_res" | null) => void;
  onBulkFrame: () => void;
}) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-center justify-between mb-4">
          <h2 className={SECTION_HEADING}>Review image layouts ({products.length} products)</h2>
          <Button type="button" variant="outline" size="sm" onClick={onBulkFrame}>
            {bulkFramed ? "Reset individual overrides" : "Enmarcar todos"}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {products.map((product) => {
            const effectiveType = overrides[product.id] ?? product.imageType ?? null;
            return (
              <div key={product.id} className={CARD + " flex items-center gap-3 p-3"}>
                {product.image ? (
                  <LazyImage
                    src={product.image}
                    alt={product.name}
                    className="size-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="size-12 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
                    No img
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{product.id}</p>
                </div>
                {product.imageType && !overrides[product.id] && (
                  <Badge variant={IMAGE_TYPE_VARIANTS[product.imageType] ?? "outline"}>
                    {IMAGE_TYPE_LABELS[product.imageType] ?? product.imageType}
                  </Badge>
                )}
                {overrides[product.id] && (
                  <Badge variant={IMAGE_TYPE_VARIANTS[overrides[product.id]!] ?? "outline"}>
                    Override: {IMAGE_TYPE_LABELS[overrides[product.id]!] ?? overrides[product.id]}
                  </Badge>
                )}
                <Select
                  value={effectiveType ?? "__auto__"}
                  onValueChange={(v) => onOverride(product.id, v === "__auto__" ? null : (v as "transparent" | "opaque" | "low_res"))}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Auto</SelectItem>
                    <SelectItem value="transparent">Transparente</SelectItem>
                    <SelectItem value="opaque">Opaca</SelectItem>
                    <SelectItem value="low_res">Baja res.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
