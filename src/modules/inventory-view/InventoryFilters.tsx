"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(params: URLSearchParams) {
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "pageSize") params.delete("page");
    pushParams(params);
  }

  function applyDebounced(key: string, value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyFilter(key, value), 300);
  }

  const setPageSize = useCallback(
    (size: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("pageSize", size);
      params.delete("page");
      pushParams(params);
    },
    [searchParams, pathname, pushParams],
  );

  const hasActiveFilters = Boolean(selected.categoryL1 || selected.categoryL2 || selected.name || selected.id || selected.stockStatus);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-id">ID</Label>
        <Input
          id="filter-id"
          placeholder="Filtrar por ID..."
          defaultValue={selected.id ?? ""}
          onChange={(e) => applyDebounced("id", e.target.value)}
          className="w-32"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-name">Nombre</Label>
        <Input
          id="filter-name"
          placeholder="Filtrar por nombre..."
          defaultValue={selected.name ?? ""}
          onChange={(e) => applyDebounced("name", e.target.value)}
          className="w-48"
        />
      </div>
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
      <button
        onClick={() => router.push(pathname)}
        className={`rounded border px-3 py-1.5 text-sm transition-colors ${
          hasActiveFilters
            ? "border-border text-foreground hover:bg-muted/20"
            : "border-transparent text-muted-foreground/30 cursor-default"
        }`}
      >
        Limpiar
      </button>
      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Label>Filas por página</Label>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(v ?? "")}>
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
