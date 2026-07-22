/**
 * Round-trip mapper (R10.1-4 — see design.md → "Database Schema Outline":
 * `producto` is a JSONB-raw + typed-projection hybrid).
 *
 * Contract VERIFIED via live smoke test (design.md): each item yielded by
 * client.ts's generator is a full product WRAPPER object with five top-level
 * keys — `Producto`, `InStock`, `PriceLists`, `Images`, `Matrix` — not a flat
 * `Producto`-only object as originally assumed.
 *
 * `raw` is the FULL wrapper stored verbatim and is the ONLY thing
 * `serializeProduct` returns — that is what guarantees parse -> store ->
 * read-back -> serialize equals the original API payload (R10.3), including
 * `Images`/`Matrix`, independent of whatever the typed projection below
 * manages to derive. A projection miss (missing/malformed field) logs a
 * warning and falls back to `null`; it must never throw or drop `raw` (R10.4).
 */

export type Producto = {
  id: string;
  raw: Record<string, unknown>;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  price: number | null;
  stock: number | null;
};

type InStockRow = { Available?: unknown };

/** Safely parses a numeric string ("40.00", "-3.0000", "0") to a number,
 * falling back to `fallback` on `NaN` instead of throwing (R10.4). */
function safeNumber(value: unknown, fallback: number | null): number | null {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Sums `Available` across every `InStock` row (confirmed: sum across all
 * warehouses). Each entry is parsed individually — `Available`'s string
 * format is inconsistent ("-3.0000" vs "0") — and a single bad/NaN entry is
 * skipped (treated as 0) rather than corrupting the whole sum. Negative
 * totals are valid and expected (real data has negative stock) — never
 * clamped to 0. */
function sumStock(inStock: unknown): number | null {
  if (!Array.isArray(inStock)) {
    return null;
  }
  return (inStock as InStockRow[]).reduce<number>((total, row) => total + (safeNumber(row?.Available, 0) ?? 0), 0);
}

/**
 * R10.4 unknown/malformed-item tolerance, reconsidered for the 5-key wrapper:
 * the old flat-object "unknown field" concept doesn't map onto this nested
 * shape (Producto alone carries dozens of passthrough-only fields — warning
 * on each would be noise, not signal). Instead this warns only when a field
 * this mapper actively DEPENDS on (`Producto`, `InStock`, `PriceLists`) is
 * entirely missing or the wrong shape, since that's the case where the typed
 * projection is silently degrading.
 */
function warnMalformedWrapper(wrapper: Record<string, unknown>, id: string): void {
  if (typeof wrapper.Producto !== "object" || wrapper.Producto === null) {
    console.warn(`[inventory-sync] product ${id} is missing/malformed "Producto"`);
  }
  if (!Array.isArray(wrapper.InStock)) {
    console.warn(`[inventory-sync] product ${id} is missing/malformed "InStock"`);
  }
  if (!Array.isArray(wrapper.PriceLists)) {
    console.warn(`[inventory-sync] product ${id} is missing/malformed "PriceLists"`);
  }
}

/** Parses one raw Interfuerza product WRAPPER ({Producto,InStock,PriceLists,
 * Images,Matrix}) into the internal Producto model. */
export function parseProduct(raw: Record<string, unknown>): Producto {
  const producto = (raw.Producto ?? {}) as Record<string, unknown>;
  if (typeof producto.id !== "string" && typeof producto.id !== "number") {
    throw new Error("Interfuerza product is missing a usable Producto.id");
  }
  const id = String(producto.id);
  warnMalformedWrapper(raw, id);

  // ponytail: trim-on-projection-but-not-on-raw is intentional, not a bug.
  // Real data has trailing whitespace on category fields (e.g.
  // "ELECTRONICA "). The typed projection is trimmed because category
  // filtering (R3) matches against user-typed, trimmed input. `raw` stays
  // completely verbatim/untrimmed because round-trip (R10.3) must reproduce
  // the exact original payload. Do NOT "fix" this into symmetry — that would
  // break one guarantee to satisfy the other.
  const categoryL1 = typeof producto.Category_L1 === "string" ? producto.Category_L1.trim() : null;
  const categoryL2 = typeof producto.Category_L2 === "string" ? producto.Category_L2.trim() : null;

  return {
    id,
    raw,
    name: typeof producto.Nombre === "string" ? producto.Nombre : "",
    categoryL1,
    categoryL2,
    price: safeNumber(producto.Precio_Venta, null),
    stock: sumStock(raw.InStock),
  };
}

/** Inverse of `parseProduct` for the round-trip guarantee — returns the full
 * `raw` wrapper verbatim, including `Images`/`Matrix`. */
export function serializeProduct(producto: Producto): Record<string, unknown> {
  return producto.raw;
}
