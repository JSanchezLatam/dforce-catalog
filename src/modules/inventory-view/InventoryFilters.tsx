"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchFilterInput } from "@/shared/ui/filters/SearchFilterInput";
import { useUrlFilters } from "@/shared/ui/filters/useUrlFilters";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * `id` and `name` are the screen the reported defect was measured on: one
 * shared debounce timer clobbered the first field's push, and `applyFilter`
 * read `searchParams.toString()` — a stale closure, reverted attempt #1
 * (design.md D2) — instead of the last-pushed params. Both are gone now:
 * `useUrlFilters` owns a per-key timer and the only `router.push` on this
 * screen (D1–D4).
 */
export function InventoryFilters({
  categoryL1Options,
  categoryL2Options,
  selected,
  pageSize,
}: {
  categoryL1Options: string[];
  categoryL2Options: string[];
  selected: { categoryL1?: string; categoryL2?: string; name?: string; id?: string; stockStatus?: string };
  pageSize: number;
}) {
  const { text, setText, applyFilter, clearAll } = useUrlFilters({
    id: selected.id ?? "",
    name: selected.name ?? "",
  });

  /**
   * `text` is in here on purpose, and it is the whole point. `selected` is the
   * SERVER's view, which lags a keystroke by the debounce — so deriving this
   * from `selected` alone disabled the button in exactly the 300ms window
   * `clearAll` exists for: type `bater`, click Limpiar, the click is a no-op
   * because the button is disabled, and the timer then filters by the term the
   * operator just tried to cancel. `clearAll` is the only thing here that
   * cancels a pending timer, so it must stay reachable while one is pending.
   */
  const hasActiveFilters = Boolean(
    selected.categoryL1 || selected.categoryL2 || selected.name || selected.id || selected.stockStatus || text.id || text.name,
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SearchFilterInput
        id="filter-id"
        label="ID"
        placeholder="Filtrar por ID..."
        value={text.id ?? ""}
        onValueChange={(v) => setText("id", v)}
        className="flex w-32 flex-col gap-1"
      />
      <SearchFilterInput
        id="filter-name"
        label="Nombre"
        placeholder="Filtrar por nombre..."
        value={text.name ?? ""}
        onValueChange={(v) => setText("name", v)}
        className="flex w-48 flex-col gap-1"
      />
      <div className="flex flex-col gap-1">
        <Label>Categoría 1</Label>
        <Select
          value={selected.categoryL1 ?? ""}
          onValueChange={(v) => applyFilter("categoryL1", v ?? "")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {categoryL1Options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Categoría 2</Label>
        <Select
          value={selected.categoryL2 ?? ""}
          onValueChange={(v) => applyFilter("categoryL2", v ?? "")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {categoryL2Options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Stock</Label>
        <Select
          value={selected.stockStatus ?? ""}
          onValueChange={(v) => applyFilter("stockStatus", v ?? "")}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            <SelectItem value="in-stock">En stock</SelectItem>
            <SelectItem value="out-of-stock">Sin stock</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        size="default"
        onClick={clearAll}
        disabled={!hasActiveFilters}
      >
        Limpiar
      </Button>
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
