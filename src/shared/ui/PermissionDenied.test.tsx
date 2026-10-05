import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PermissionDenied } from "./PermissionDenied";

/**
 * Audit #18: fifteen pages hand-copied one bare sentence. This is the shared
 * refusal screen, so these pin the contract; the 390px look is the LAN check.
 */
describe("PermissionDenied", () => {
  it("shows the page's own title as the h1", () => {
    render(<PermissionDenied title="Vencimientos próximos" />);

    expect(screen.getByRole("heading", { level: 1, name: "Vencimientos próximos" })).toBeInTheDocument();
  });

  it("says no tenés permiso and what to do about it", () => {
    render(<PermissionDenied title="Clientes" />);

    expect(
      screen.getByRole("heading", { level: 2, name: "No tenés permiso para ver esta página" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pedile acceso a un administrador.")).toBeInTheDocument();
  });

  it("offers a 44px 'Volver al inicio' link to the root", () => {
    render(<PermissionDenied title="Clientes" />);

    const link = screen.getByRole("link", { name: "Volver al inicio" });
    expect(link).toHaveAttribute("href", "/");
    // A whole-class check: the base button already carries `pointer-coarse:min-h-11`,
    // which a substring match would take for the unconditional floor.
    expect(link.classList.contains("min-h-11")).toBe(true);
  });

  it("draws a decorative lock icon", () => {
    const { container } = render(<PermissionDenied title="Clientes" />);

    const icon = container.querySelector("svg.lucide-lock");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
