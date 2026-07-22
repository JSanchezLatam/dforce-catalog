import { describe, expect, it, vi } from "vitest";

import { parseProduct, serializeProduct } from "./mapper";

/**
 * Hand-written fixtures covering the round-trip property (R10.3) instead of a
 * `fast-check` property-based suite: a small representative + edge-case set
 * (typical shape, numeric id, falsy-but-defined values, an unknown field,
 * nulls, and a nested unknown structure) exercises the same invariant with
 * far less ceremony than adding a new dependency for it.
 */
const fixtures: Record<string, unknown>[] = [
  {
    id: "1",
    name: "Filtro de aceite",
    category_l1: "Motor",
    category_l2: "Filtros",
    price: 12.5,
    stock: 40,
  },
  { id: 2, name: "Bujía", category_l1: "Encendido" }, // numeric id, missing optional fields
  {
    id: "3",
    name: "Correa",
    category_l1: "Motor",
    category_l2: "Distribución",
    price: 0,
    stock: 0,
    extra_field: "unlisted",
  }, // falsy-but-defined numbers + an unknown field
  { id: "4", name: "", price: null, stock: null, category_l1: null }, // explicit nulls
  { id: "5", name: "Kit completo", metadata: { origen: "OEM", detalles: [1, 2, 3] } }, // nested unknown structure
];

describe("round-trip: parse -> serialize equivalence (R10.3)", () => {
  it.each(fixtures)("preserves the raw payload verbatim for %j", (raw) => {
    const producto = parseProduct(raw);
    const serialized = serializeProduct(producto);
    expect(serialized).toEqual(raw);
  });

  it("survives a simulated JSONB store+read round trip (JSON serialize/parse)", () => {
    for (const raw of fixtures) {
      const producto = parseProduct(raw);
      const storedThenRead = JSON.parse(JSON.stringify(serializeProduct(producto))) as Record<string, unknown>;
      expect(storedThenRead).toEqual(raw);
    }
  });

  it("warns but does not throw on an unknown field, keeping the page processable (R10.4)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const producto = parseProduct({ id: "6", name: "X", made_up_field: true });

    expect(producto.raw).toEqual({ id: "6", name: "X", made_up_field: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("made_up_field"));
    warnSpy.mockRestore();
  });

  it("derives null projections instead of throwing when typed fields are malformed (R10.4)", () => {
    const producto = parseProduct({ id: "7", price: "not-a-number", stock: "also-not-a-number" });

    expect(producto.price).toBeNull();
    expect(producto.stock).toBeNull();
    expect(producto.raw).toEqual({ id: "7", price: "not-a-number", stock: "also-not-a-number" });
  });

  it("throws when a product has no usable id", () => {
    expect(() => parseProduct({ name: "no id" })).toThrow(/id/);
  });
});
