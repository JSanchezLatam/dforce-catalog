"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchFilterInput } from "@/shared/ui/filters/SearchFilterInput";
import { useUrlFilters } from "@/shared/ui/filters/useUrlFilters";
import type { ClienteFilters } from "./queries";

/** Imported, not redeclared: two definitions of one union can drift apart. */
type ClienteStatus = NonNullable<ClienteFilters["status"]>;

const STATUS_OPTIONS: ClienteStatus[] = ["active", "inactive", "all"];
const STATUS_LABELS: Record<ClienteStatus, string> = {
  active: "Activos",
  inactive: "Desactivados",
  all: "Todos",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * R19 — single combined name/phone/plate search box, URL-driven (debounced
 * `router.push`), mirrors `InventoryFilters.tsx`'s exact pattern (design.md
 * §8: "Name/phone/plate filter card like InventoryFilters"). ONE input, not
 * three — `customers/queries.ts`'s `buildClienteSearchWhere` already ORs the
 * same search term across all three columns (R19's literal wording: "a
 * partial, case-insensitive match against name, phone, or vehicle plate"), so
 * three separate fields would misrepresent how the query actually filters.
 *
 * The URL/debounce race lives in `useUrlFilters` now (list-search-filters
 * design D1–D6) — this component owns no `router.push` and no ref.
 */
export function CustomerFilters({
  selected,
  pageSize,
}: {
  selected: { search?: string; status?: ClienteStatus };
  pageSize: number;
}) {
  const { text, setText, applyFilter, clearAll, hasTypedText } = useUrlFilters({ search: selected.search ?? "" });

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
      <SearchFilterInput
        id="filter-search"
        label="Filtro"
        placeholder="Buscar por nombre, placa o teléfono"
        value={text.search ?? ""}
        onValueChange={(v) => setText("search", v)}
        className="flex min-w-72 flex-1 flex-col gap-1.5"
      />
      {/* R20 — URL state like `search` and `pageSize`, not client state. A
          filter that does not survive a refresh or a shared link is one staff
          will not trust. Undebounced: a select has no keystrokes to wait out.

          Three states, not the old checkbox: that one could say active or
          all, and had no way to say ONLY the deactivated ones — which is what
          someone looking for a customer they retired is actually asking. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-status">Estado</Label>
        <Select
          value={selected.status ?? "active"}
          onValueChange={(v) => applyFilter("status", v === "active" ? "" : (v ?? ""))}
        >
          <SelectTrigger id="filter-status" className="w-44">
            {/* Render function, not a bare `<SelectValue />`: Base UI prints the
                raw VALUE otherwise, so the trigger read "active" instead of
                "Activos". The `pageSize` select gets away with it only because
                its value and its label are the same string. */}
            <SelectValue>{(value) => STATUS_LABELS[value as ClienteStatus] ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {STATUS_LABELS[opt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(hasTypedText || selected.search || (selected.status && selected.status !== "active")) && (
        // `size="default"` is h-8, the same height as the `Input` and
        // `SelectTrigger` beside it (`input.tsx` is `h-8` too), so `items-end`
        // on the row lines all three up.
        <Button type="button" variant="outline" size="default" onClick={clearAll}>
          <X aria-hidden="true" />
          Limpiar
        </Button>
      )}
      <div className="ml-auto flex flex-col gap-1.5">
        <Label htmlFor="filter-page-size">Filas por página</Label>
        <Select value={String(pageSize)} onValueChange={(v) => applyFilter("pageSize", v ?? "")}>
          <SelectTrigger id="filter-page-size" className="w-20">
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
