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

const CARDS = [
  ["TransparentProductCard", TransparentProductCard],
  ["OpaqueProductCard", OpaqueProductCard],
] as const;

describe.each(CARDS)("%s — three-tier price rendering", (_name, Card) => {
  it("renders all three tiers, bold, labeled Venta/Taller/Socio", () => {
    render(<Card product={product({ venta: 120, taller: 100, socio: 90 })} />);

    expect(screen.getByText(/Venta/)).toBeInTheDocument();
    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Taller/)).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Socio/)).toBeInTheDocument();
    expect(screen.getByText(/\$90\.00/)).toBeInTheDocument();
  });

  it("renders an em-dash for one missing tier, without touching the other two", () => {
    render(<Card product={product({ venta: 120, taller: null, socio: 90 })} />);

    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$90\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Taller.*—/)).toBeInTheDocument();
  });

  it("renders three em-dashes when prices is entirely absent", () => {
    render(<Card product={product(null)} />);

    expect(screen.getAllByText(/—/)).toHaveLength(3);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  // The exact defect this em-dash rule exists to prevent: a hostile/real ERP
  // "0.00" tier must never render as "$0.00" in a customer-facing catalog.
  it("renders a hostile 0 tier as an em-dash, never $0.00", () => {
    render(<Card product={product({ venta: 0, taller: 100, socio: 0 })} />);

    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/—/)).toHaveLength(2);
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });
});
