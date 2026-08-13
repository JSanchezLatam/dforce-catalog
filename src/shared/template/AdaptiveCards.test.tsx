/**
 * Component tests for money rendering (catalog-templates-and-workshop-info
 * WU4, task 4.4). `AdaptiveCards.tsx` had no test file before this unit even
 * though it owns the em-dash rule — explore.md flagged this as the gap
 * Strict TDD must close in the same work unit that rewrites this file.
 *
 * Both `TransparentProductCard` and `OpaqueProductCard` share the one
 * `ProductPrices` sub-component (design D4), so every case is asserted on
 * both to prove the two never format money differently.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ProductPrintRef } from "./CatalogTemplate";
import { OpaqueProductCard, TransparentProductCard } from "./AdaptiveCards";

function product(prices: ProductPrintRef["prices"]): ProductPrintRef {
  return { id: "p1", name: "Woofer", categoryL1: "AUDIO", categoryL2: null, prices };
}

/** The registry pair the real template hands its cards (design D1/D2). */
const COLORS = { primary: "#D42027", secondary: "#111111" };

const CARDS = [
  ["TransparentProductCard", TransparentProductCard],
  ["OpaqueProductCard", OpaqueProductCard],
] as const;

describe.each(CARDS)("%s — three-tier price rendering", (_name, Card) => {
  it("renders all three tiers, bold, labeled Venta/Taller/Socio", () => {
    render(<Card colors={COLORS} product={product({ venta: 120, taller: 100, socio: 90 })} />);

    expect(screen.getByText(/Venta/)).toBeInTheDocument();
    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Taller/)).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Socio/)).toBeInTheDocument();
    expect(screen.getByText(/\$90\.00/)).toBeInTheDocument();
  });

  it("renders an em-dash for one missing tier, without touching the other two", () => {
    render(<Card colors={COLORS} product={product({ venta: 120, taller: null, socio: 90 })} />);

    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$90\.00/)).toBeInTheDocument();
    // The em-dash has to land in the TALLER row specifically — asserting only
    // that the card contains one somewhere would pass with it beside the wrong
    // tier. Label and amount are the two cells of one price row, so the amount
    // is the label's sibling.
    expect(screen.getByText("Taller").nextElementSibling).toHaveTextContent("—");
  });

  it("renders three em-dashes when prices is entirely absent", () => {
    render(<Card colors={COLORS} product={product(null)} />);

    expect(screen.getAllByText(/—/)).toHaveLength(3);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  // The exact defect this em-dash rule exists to prevent: a hostile/real ERP
  // "0.00" tier must never render as "$0.00" in a customer-facing catalog.
  it("renders a hostile 0 tier as an em-dash, never $0.00", () => {
    render(<Card colors={COLORS} product={product({ venta: 0, taller: 100, socio: 0 })} />);

    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/—/)).toHaveLength(2);
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });
});

/**
 * The card's Spanish copy. This document is printed and handed to a customer,
 * so an untranslated string is not a cosmetic slip — and the copy is exactly
 * the kind of thing a refactor drops without failing anything else.
 */
describe.each(CARDS)("%s — printed copy", (_name, Card) => {
  const withImage = (image: string | null): ProductPrintRef => ({
    id: "PS0000570",
    name: "Woofer",
    categoryL1: "AUDIO",
    categoryL2: null,
    image,
    prices: null,
  });

  it("prints the ERP id as the product code", () => {
    render(<Card colors={COLORS} product={withImage("https://x/img.png")} />);
    expect(screen.getByText("Cód. PS0000570")).toBeInTheDocument();
  });

  it("labels a product with no photo in Spanish rather than leaving a blank column", () => {
    render(<Card colors={COLORS} product={withImage(null)} />);
    expect(screen.getByText("SIN IMAGEN")).toBeInTheDocument();
  });

  /**
   * The placeholder holds the image column open on its own. Without a floor it
   * collapses to nothing, the card gets shorter than its neighbour, and the
   * whole grid row it shares resizes around one product that has no photo.
   */
  it("keeps the placeholder's footprint so a photo-less product does not resize its row", () => {
    render(<Card colors={COLORS} product={withImage(null)} />);
    expect(screen.getByText("SIN IMAGEN")).toHaveStyle({ minHeight: "150px" });
  });
});
