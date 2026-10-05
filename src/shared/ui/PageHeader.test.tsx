import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

/**
 * Audit #1 #11 #12: every page hand-built its header (`flex items-center
 * justify-between`, no wrap), which pushed "Nueva orden de servicio" off a
 * 390px screen. jsdom computes no layout, so these pin the contract (an `h1`,
 * a wrapping actions container, an optional subtitle); the LAN check at 390 is
 * the layout evidence.
 */
describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="Órdenes de servicio" />);

    expect(screen.getByRole("heading", { level: 1, name: "Órdenes de servicio" })).toBeInTheDocument();
  });

  it("puts every action in one wrapping container, in the given order", () => {
    render(
      <PageHeader
        title="Órdenes de servicio"
        actions={
          <>
            <button type="button">Actualizar</button>
            <button type="button">Nueva orden de servicio</button>
          </>
        }
      />,
    );

    const first = screen.getByRole("button", { name: "Actualizar" });
    const second = screen.getByRole("button", { name: "Nueva orden de servicio" });
    expect(first.parentElement).toBe(second.parentElement);
    expect(first.parentElement).toHaveClass("flex-wrap");
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wraps the title block and the actions so actions drop below a long title", () => {
    const { container } = render(<PageHeader title="Clientes" actions={<button type="button">Nuevo cliente</button>} />);

    expect(container.firstElementChild).toHaveClass("flex", "flex-wrap");
  });

  it("renders the subtitle only when given", () => {
    const { container, rerender } = render(<PageHeader title="Clientes" />);
    // No `<p>` at all, not merely no text: an empty subtitle still takes its `mt-1`.
    expect(container.querySelector("p")).toBeNull();

    rerender(<PageHeader title="Clientes" description="Los clientes del taller." />);
    expect(screen.getByText("Los clientes del taller.")).toBeInTheDocument();
  });

  it("lets the caller class the subtitle paragraph itself, so a hidden one leaves no box behind", () => {
    render(<PageHeader title="Inventario" description="7 productos" descriptionClassName="md:hidden" />);

    const subtitle = screen.getByText("7 productos");
    expect(subtitle.tagName).toBe("P");
    expect(subtitle).toHaveClass("mt-1", "text-sm", "md:hidden");
  });

  it("renders no actions container when there are no actions", () => {
    const { container } = render(<PageHeader title="Clientes" />);

    expect(container.querySelector(".flex-wrap.gap-2")).toBeNull();
  });
});
