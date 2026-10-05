/**
 * Audit #12: "tarjeta dentro de tarjeta y el margen se duplica". The grid is
 * made of cards, so a page Card around it nested one in another and a phone
 * paid ~32px per side before any content.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "administrador" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can: () => true }));
vi.mock("@/modules/catalog-storage/queries", () => ({
  listAllCatalogs: vi.fn(async () => []),
  listCatalogsForUser: vi.fn(async () => []),
}));

// Stand-ins for the client subtree: this file asserts the PAGE's own wrapper,
// and the real grid needs a poll provider, toasts and catalog rows.
vi.mock("@/modules/catalog-storage/CatalogPollProvider", () => ({
  CatalogPollProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/catalog-storage/CatalogGrid", () => ({
  CatalogGrid: () => <div data-testid="catalog-grid" />,
}));

import { listAllCatalogs } from "@/modules/catalog-storage/queries";
import CatalogsPage from "./page";

describe("CatalogsPage — header and padding (audit #12)", () => {
  it("titles the page with an h1", async () => {
    render(await CatalogsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Mis catálogos" })).toBeInTheDocument();
  });

  // #12, the part the padding fix left: the grid is made of cards, so wrapping
  // it (or the empty state) in a page Card nested a card in a card and cost a
  // phone ~32px per side.
  it("does not wrap the empty state in a page card", async () => {
    render(await CatalogsPage());

    const empty = screen.getByText("No hay catálogos aún");
    expect(empty.closest("[data-slot='card']")).toBeNull();
  });

  it("does not wrap the catalog grid in a page card", async () => {
    vi.mocked(listAllCatalogs).mockResolvedValueOnce([{ id: "cat-1" }] as never);
    render(await CatalogsPage());

    expect(screen.getByTestId("catalog-grid").closest("[data-slot='card']")).toBeNull();
  });
});
