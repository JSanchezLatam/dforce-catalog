/**
 * Audit #12: "tarjeta dentro de tarjeta y el margen se duplica". The page card's
 * `CardContent` carried `p-6` on top of the card's own spacing, and the grid
 * inside is made of cards too, so a phone paid 24px twice before any content.
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

import CatalogsPage from "./page";

describe("CatalogsPage — header and padding (audit #12)", () => {
  it("titles the page with an h1", async () => {
    render(await CatalogsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Mis catálogos" })).toBeInTheDocument();
  });

  it("does not stack a second padding on the page card's content", async () => {
    render(await CatalogsPage());

    const content = screen.getByText("No hay catálogos aún").closest("[data-slot='card-content']");
    expect(content).not.toBeNull();
    expect(content).not.toHaveClass("p-6");
  });
});
