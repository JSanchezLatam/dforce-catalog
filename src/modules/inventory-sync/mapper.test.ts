import { describe, expect, it, vi } from "vitest";

import { parseProduct, serializeProduct } from "./mapper";

/** A representative real-shape fixture (per design.md's live smoke test):
 * five top-level keys, trailing whitespace on categories, string numerics. */
function wrapperFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    Producto: {
      id: "PS0000001",
      Nombre: "BOCINA 6 PRO ATS 1050w",
      Status: "ACTIVO",
      Category_L1: "ELECTRONICA ",
      Category_L2: "BOCINAS",
      Category_L3: "",
      Precio_Venta: "40.00",
      UPC_Code: "123456789012",
      Marca: "ATS",
    },
    InStock: [
      { WareHouse: "Bodega Principal", Intransit: "0.00", Display: "0.00", Reservado: "0.00", InStock: "-3.00", Available: "-3.0000" },
      { WareHouse: "SALIDA DE BODEGA ", Intransit: "0.00", Display: "0.00", Reservado: "0.00", InStock: "0.00", Available: "0" },
    ],
    PriceLists: [{ Name: "Precio de venta ", Precio: "40.00", Precio_Real: "40.00" }],
    Images: [{ src: "https://example.com/img.jpg" }],
    Matrix: [],
    ...overrides,
  };
}

describe("round-trip: parse -> serialize equivalence on the full 5-key wrapper (R10.3)", () => {
  it("preserves the raw payload verbatim, including Images and Matrix", () => {
    const raw = wrapperFixture();
    const producto = parseProduct(raw);
    expect(serializeProduct(producto)).toEqual(raw);
    expect(serializeProduct(producto)).toBe(raw);
  });

  it("survives a simulated JSONB store+read round trip (JSON serialize/parse)", () => {
    const raw = wrapperFixture();
    const producto = parseProduct(raw);
    const storedThenRead = JSON.parse(JSON.stringify(serializeProduct(producto))) as Record<string, unknown>;
    expect(storedThenRead).toEqual(raw);
  });

  it("round-trips non-empty Images/Matrix arrays exactly", () => {
    const raw = wrapperFixture({
      Images: [{ src: "https://example.com/a.jpg" }, { src: "https://example.com/b.jpg" }],
      Matrix: [{ variant: "rojo" }],
    });
    const producto = parseProduct(raw);
    expect(serializeProduct(producto)).toEqual(raw);
  });
});

describe("stock: sum of InStock[].Available across warehouses", () => {
  it("is 0 when InStock is empty", () => {
    const producto = parseProduct(wrapperFixture({ InStock: [] }));
    expect(producto.stock).toBe(0);
  });

  it("sums a single InStock entry", () => {
    const producto = parseProduct(wrapperFixture({ InStock: [{ Available: "12.5" }] }));
    expect(producto.stock).toBe(12.5);
  });

  it("sums many entries, including negatives and mixed string formats", () => {
    const producto = parseProduct(
      wrapperFixture({
        InStock: [{ Available: "-3.0000" }, { Available: "0" }, { Available: "10" }, { Available: "5.25" }],
      }),
    );
    expect(producto.stock).toBe(12.25);
  });

  it("allows a negative total (does not clamp to 0)", () => {
    const producto = parseProduct(wrapperFixture({ InStock: [{ Available: "-3.0000" }, { Available: "0" }] }));
    expect(producto.stock).toBe(-3);
  });

  it("skips a single malformed Available entry instead of crashing the whole sum", () => {
    const producto = parseProduct(
      wrapperFixture({ InStock: [{ Available: "not-a-number" }, { Available: "10" }] }),
    );
    expect(producto.stock).toBe(10);
  });
});

describe("price: Producto.Precio_Venta string-to-number parsing", () => {
  it("parses a numeric string to a number", () => {
    const producto = parseProduct(wrapperFixture());
    expect(producto.price).toBe(40);
  });

  it("falls back to null on a malformed/non-numeric price instead of throwing", () => {
    const raw = wrapperFixture();
    (raw.Producto as Record<string, unknown>).Precio_Venta = "not-a-price";
    expect(() => parseProduct(raw)).not.toThrow();
    expect(parseProduct(raw).price).toBeNull();
  });
});

describe("category trim asymmetry: trimmed typed projection, verbatim raw (R3 vs R10.3)", () => {
  it("trims categoryL1/categoryL2 in the typed projection but keeps raw untrimmed", () => {
    const raw = wrapperFixture();
    const producto = parseProduct(raw);

    expect(producto.categoryL1).toBe("ELECTRONICA");
    expect(producto.categoryL2).toBe("BOCINAS");
    expect((producto.raw.Producto as Record<string, unknown>).Category_L1).toBe("ELECTRONICA ");
  });
});

describe("unknown/malformed-item warning logic (R10.4, reconsidered for the nested wrapper)", () => {
  it("warns but does not throw when Producto is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = wrapperFixture();
    delete raw.Producto;
    (raw as Record<string, unknown>).Producto = { id: "PS0000002" };

    expect(() => parseProduct(raw)).not.toThrow();
    warnSpy.mockRestore();
  });

  it("warns when InStock is missing/malformed but still parses (stock null)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = wrapperFixture({ InStock: undefined });

    const producto = parseProduct(raw);

    expect(producto.stock).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("InStock"));
    warnSpy.mockRestore();
  });

  it("warns when PriceLists is missing/malformed but still parses", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = wrapperFixture({ PriceLists: "not-an-array" });

    expect(() => parseProduct(raw)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("PriceLists"));
    warnSpy.mockRestore();
  });

  it("does not warn on unenumerated passthrough-only Producto fields", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    parseProduct(wrapperFixture());
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws when Producto.id is missing entirely", () => {
    const raw = wrapperFixture();
    delete (raw.Producto as Record<string, unknown>).id;
    expect(() => parseProduct(raw)).toThrow(/id/);
  });

  it("accepts a numeric Producto.id", () => {
    const raw = wrapperFixture();
    (raw.Producto as Record<string, unknown>).id = 123;
    expect(parseProduct(raw).id).toBe("123");
  });
});
