"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchFilterInput } from "@/shared/ui/filters/SearchFilterInput";
import { useUrlFilters } from "@/shared/ui/filters/useUrlFilters";
import { ORDER_STATUS_LABEL } from "./statuses";
import type { OrderStatus } from "./transitions";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "booked", label: ORDER_STATUS_LABEL.booked },
  { value: "open", label: ORDER_STATUS_LABEL.open },
  { value: "diagnosing", label: ORDER_STATUS_LABEL.diagnosing },
  { value: "in_progress", label: ORDER_STATUS_LABEL.in_progress },
  { value: "on_hold", label: ORDER_STATUS_LABEL.on_hold },
  { value: "ready_for_review", label: ORDER_STATUS_LABEL.ready_for_review },
  { value: "done", label: ORDER_STATUS_LABEL.done },
  { value: "cancelled", label: ORDER_STATUS_LABEL.cancelled },
];

/**
 * R21/D7 — status-filter Select plus a search box, URL-driven. `useUrlFilters`
 * (list-search-filters design D1/D6) is the fourth call site of the shared
 * hook — status/pageSize/`Limpiar` already routed through it (Phase 1) so
 * this search box cannot become a second writer on this screen.
 */
export function ServiceOrderFilters({
  selected,
  pageSize,
}: {
  selected: { search?: string; status?: OrderStatus };
  pageSize: number;
}) {
  const { text, setText, applyFilter, clearAll, hasTypedText } = useUrlFilters({ search: selected.search ?? "" });

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <SearchFilterInput
        id="filter-search"
        label="Filtro"
        placeholder="Buscar por nombre, placa o teléfono"
        value={text.search ?? ""}
        onValueChange={(v) => setText("search", v)}
        className="flex min-w-72 flex-1 flex-col gap-1.5"
      />
      <div className="flex flex-col gap-1">
        <Label>Estado</Label>
        <Select items={STATUS_OPTIONS} value={selected.status ?? ""} onValueChange={(v) => applyFilter("status", v ?? "")}>
          <SelectTrigger className="w-48">
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
      {(hasTypedText || selected.search || selected.status) && (
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
