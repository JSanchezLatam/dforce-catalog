/**
 * PR A — the "Listas de precios" card rendered blank on all 699 products
 * because it read `ListName`/`Price`, two keys the ERP payload does not have.
 *
 * The fixture below is `producto` row `PS0000084` COPIED OUT OF THE DEV
 * DATABASE, trailing spaces and all — not a convenient invention. It is a
 * service row on purpose: it is one of the 37 products where `Precio` and
 * `Precio_Real` disagree, and in every one of those `Precio_Real` is "0.00"
 * (see the header of `src/modules/catalog-builder/price-lists.ts`). So an
 * implementation that reaches for `Precio_Real` prints $0.00 here and fails.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));

const getProductById = vi.hoisted(() => vi.fn());
vi.mock("@/modules/inventory-view/queries", () => ({ getProductById }));

import ProductDetailPage from "./page";

/** Verbatim `raw->'PriceLists'` of PS0000084. The trailing spaces are real. */
const PRICE_LISTS = [
  { Name: "Precio de venta ", Precio: "50.00", Precio_Real: "0.00" },
  { Name: "PRECIO TALLER ", Precio: "45.00", Precio_Real: "0.00" },
  { Name: "Precio Socio ", Precio: "0.00", Precio_Real: "0.00" },
];

function renderPage() {
  getProductById.mockResolvedValue({
    id: "PS0000084",
    name: "CAMBIO DE ABANICO CAMIONETA [MANO DE OBRA]",
    price: 50,
    stock: 0,
    categoryL1: "",
    categoryL2: "",
    raw: {
      Producto: { id: "PS0000084", Nombre: "CAMBIO DE ABANICO CAMIONETA [MANO DE OBRA]", Marca: "", Precio_Venta: "50.00" },
      Images: [],
      PriceLists: PRICE_LISTS,
    },
  });
  return ProductDetailPage({ params: Promise.resolve({ id: "PS0000084" }) });
}

/** Defeats testing-library's default normalizer, which would trim for us. */
const verbatim = { normalizer: (s: string) => s };

describe("ProductDetailPage — Listas de precios", () => {
  it("names each tier from the ERP's `Name`, trimmed", async () => {
    render(await renderPage());

    // Trimmed: `Name` carries trailing whitespace, the same trap
    // `price-lists.ts` documents. An untrimmed label fails here.
    expect(screen.getByText("Precio de venta", verbatim)).toBeInTheDocument();
    expect(screen.getByText("PRECIO TALLER", verbatim)).toBeInTheDocument();
    expect(screen.getByText("Precio Socio", verbatim)).toBeInTheDocument();
    expect(screen.queryByText(/^Lista \d$/)).not.toBeInTheDocument();
  });

  it("shows `Precio`, not `Precio_Real`", async () => {
    render(await renderPage());

    // Read off each tier's own `<dd>` rather than the page at large: the top
    // card carries a "Precio" row of its own, and pairing label to value is
    // the stronger assertion anyway.
    const priceFor = (label: string) => screen.getByText(label, verbatim).nextElementSibling?.textContent;

    expect(priceFor("Precio de venta")).toBe("$50.00");
    expect(priceFor("PRECIO TALLER")).toBe("$45.00");
    // `Precio_Real` is "0.00" on all three of this row's lists, so reading it
    // would collapse the card to three $0.00s — the same blankness, quieter.
    expect(priceFor("Precio Socio")).toBe("$0.00");
  });
});
