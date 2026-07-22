"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { INPUT, LABEL } from "@/shared/ui/styles";

/**
 * Category filter selects (R3.1/3.2). Updates the URL via `router.push` —
 * Next.js App Router soft-navigates (no full reload), same mechanism the
 * pagination `<Link>`s in `page.tsx` rely on for R4's "no full reload"
 * requirement. Reset to page 1 on every filter change (a new filter changes
 * what "page 2" even means).
 */
export function InventoryFilters({
  categoryL1Options,
  categoryL2Options,
  selected,
}: {
  categoryL1Options: string[];
  categoryL2Options: string[];
  selected: { categoryL1?: string; categoryL2?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilter(key: "categoryL1" | "categoryL2", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Selecting a new L1 invalidates whatever L2 was picked under the old L1.
    if (key === "categoryL1") {
      params.delete("categoryL2");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasActiveFilters = Boolean(selected.categoryL1 || selected.categoryL2);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <label className={LABEL}>
        Category L1
        <select
          className={`mt-1 ${INPUT}`}
          value={selected.categoryL1 ?? ""}
          onChange={(e) => applyFilter("categoryL1", e.target.value)}
        >
          <option value="">All</option>
          {categoryL1Options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Category L2
        <select
          className={`mt-1 ${INPUT}`}
          value={selected.categoryL2 ?? ""}
          onChange={(e) => applyFilter("categoryL2", e.target.value)}
        >
          <option value="">All</option>
          {categoryL2Options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {hasActiveFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="rounded border border-dragon-muted px-3 py-2 text-sm text-dragon-fg hover:bg-dragon-muted/20"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
