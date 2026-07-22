/**
 * Round-trip mapper (R10.1-4 — see design.md → "Database Schema Outline":
 * `producto` is a JSONB-raw + typed-projection hybrid).
 *
 * `raw` is stored verbatim and is the ONLY thing `serializeProduct` returns —
 * that is what guarantees parse -> store -> read-back -> serialize equals
 * the original API payload (R10.3), independent of whatever the typed
 * projection below manages to derive. A projection miss (missing/malformed
 * field) logs a warning and falls back to `null`; it must never throw or
 * drop `raw` (R10.4).
 */

const KNOWN_FIELDS = new Set(["id", "name", "category_l1", "category_l2", "price", "stock"]);

export type Producto = {
  id: string;
  raw: Record<string, unknown>;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  price: number | null;
  stock: number | null;
};

function warnUnknownFields(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.has(key)) {
      // R10.4 — unknown fields are tolerated, not fatal; the page keeps processing.
      console.warn(`[inventory-sync] unknown field "${key}" on product ${String(raw.id)}`);
    }
  }
}

/** Parses one raw Interfuerza product into the internal Producto model. */
export function parseProduct(raw: Record<string, unknown>): Producto {
  if (typeof raw.id !== "string" && typeof raw.id !== "number") {
    throw new Error("Interfuerza product is missing a usable id");
  }
  warnUnknownFields(raw);

  return {
    id: String(raw.id),
    raw,
    name: typeof raw.name === "string" ? raw.name : "",
    categoryL1: typeof raw.category_l1 === "string" ? raw.category_l1 : null,
    categoryL2: typeof raw.category_l2 === "string" ? raw.category_l2 : null,
    price: typeof raw.price === "number" ? raw.price : null,
    stock: typeof raw.stock === "number" ? raw.stock : null,
  };
}

/** Inverse of `parseProduct` for the round-trip guarantee — returns `raw` verbatim. */
export function serializeProduct(producto: Producto): Record<string, unknown> {
  return producto.raw;
}
