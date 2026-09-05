"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * R19 — single combined name/phone/plate search box, URL-driven (debounced
 * `router.push`), mirrors `InventoryFilters.tsx`'s exact pattern (design.md
 * §8: "Name/phone/plate filter card like InventoryFilters"). ONE input, not
 * three — `customers/queries.ts`'s `buildClienteSearchWhere` already ORs the
 * same search term across all three columns (R19's literal wording: "a
 * partial, case-insensitive match against name, phone, or vehicle plate"), so
 * three separate fields would misrepresent how the query actually filters.
 */
export function CustomerFilters({
  selected,
  pageSize,
}: {
  selected: { search?: string; includeInactive?: boolean };
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "pageSize") params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyDebounced(key: string, value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyFilter(key, value), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-search">Buscar (nombre, teléfono o placa)</Label>
        <Input
          id="filter-search"
          placeholder="Buscar cliente..."
          defaultValue={selected.search ?? ""}
          onChange={(e) => applyDebounced("search", e.target.value)}
          className="w-64"
        />
      </div>
      {/* R20 — URL state like `search` and `pageSize`, not client state. A
          filter that does not survive a refresh or a shared link is one staff
          will not trust. Undebounced: a checkbox has no keystrokes to wait
          out. */}
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-foreground">
        <Checkbox
          checked={selected.includeInactive === true}
          onCheckedChange={(checked) => applyFilter("includeInactive", checked === true ? "1" : "")}
        />
        Ver desactivados
      </label>
      {(selected.search || selected.includeInactive) && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="rounded border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/20"
        >
          Limpiar
        </button>
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
