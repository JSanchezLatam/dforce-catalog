"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlFilters } from "@/shared/ui/filters/useUrlFilters";
import type { OrderStatus } from "./transitions";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "open", label: "Abierta" },
  { value: "in_progress", label: "En progreso" },
  { value: "done", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

/**
 * R21 — status-filter Select, URL-driven. `useUrlFilters` (list-search-filters
 * design D1/D6) is the fourth call site of the shared hook — no search box
 * yet, that arrives with WU2, but status/pageSize/Limpiar route through it
 * now so the search box cannot become a second writer on this screen.
 */
export function ServiceOrderFilters({
  selected,
  pageSize,
}: {
  selected: { status?: OrderStatus };
  pageSize: number;
}) {
  const { applyFilter, clearAll, hasTypedText } = useUrlFilters({});

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-col gap-1">
        <Label>Estado</Label>
        <Select value={selected.status ?? ""} onValueChange={(v) => applyFilter("status", v ?? "")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* `hasTypedText` is structurally false today — this screen has no text
          field until WU2 adds its search box. Kept, not dead code: WU2 makes it
          live, and the alternative is re-learning why it is needed. */}
      {(hasTypedText || selected.status) && (
        <Button type="button" variant="outline" size="default" onClick={clearAll}>
          Limpiar
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Label>Filas por página</Label>
        <Select value={String(pageSize)} onValueChange={(v) => applyFilter("pageSize", v ?? "")}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
