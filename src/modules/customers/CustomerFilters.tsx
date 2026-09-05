"use client";

import { useEffect, useRef } from "react";
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
  /**
   * `applyFilter` is the ONLY writer of this component's query string, so the
   * params it last pushed are authoritative the instant it pushes them. That
   * is what makes this ref synchronous by construction, and it is the only
   * thing here that is.
   *
   * Two earlier attempts were both wrong, and the second one shipped:
   *
   *  1. Reading `searchParams` from the closure. `applyDebounced` schedules
   *     that closure 300ms out, so a push landing inside the window was
   *     overwritten by the stale snapshot — the operator ticked "Ver
   *     desactivados" and watched it come back unticked.
   *  2. Reading `window.location.search` at fire time, with a comment claiming
   *     it is "current by definition". It is not. In Next 16,
   *     `router.push` only dispatches into the React action queue;
   *     `window.history.pushState` runs from a `useEffect` keyed on
   *     `appRouterState` (`next/dist/client/components/app-router.js:64,70`),
   *     so the URL lands only after React commits the navigation — which on a
   *     server-component page means after the RSC payload arrives. That turned
   *     a 300ms race against a re-render into a 300ms race against a network
   *     round trip over a list query that is a sequential scan. Narrower, not
   *     closed.
   *
   * `null` means "no push of ours is outstanding, trust the URL". The effect
   * resets it when an EXTERNAL navigation changes `searchParams` — a back
   * button or a `<Link>` — which is the one case that is not racing a debounce
   * the user just started.
   */
  const pushedParamsRef = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    pushedParamsRef.current = null;
  }, [searchParams]);

  /** The search box is uncontrolled, so clearing the URL is not enough to clear what is on screen. */
  const searchInputRef = useRef<HTMLInputElement>(null);

  /**
   * The ONE `router.push` in this file, and that is the point rather than a
   * coincidence. The comment above used to CLAIM `applyFilter` was the only
   * writer while "Limpiar" pushed on its own forty lines below — updating
   * neither the ref nor the pending debounce, so a cleared filter came back on
   * the next keystroke. An invariant asserted in prose is not an invariant;
   * this makes a second writer something you would have to add a second
   * `router.push` to create.
   */
  function commit(params: URLSearchParams) {
    pushedParamsRef.current = params;
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(pushedParamsRef.current ?? window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "pageSize") params.delete("page");
    commit(params);
  }

  /**
   * Cancels the pending search, unlike `applyFilter`. An immediate filter must
   * NOT cancel a debounced one — typing "perez" and then ticking the box has to
   * keep both — but clearing must, or the timer fires afterwards and re-pushes
   * the very term the operator just cleared.
   */
  function clearFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchInputRef.current) searchInputRef.current.value = "";
    commit(new URLSearchParams());
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
          ref={searchInputRef}
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
          onClick={clearFilters}
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
