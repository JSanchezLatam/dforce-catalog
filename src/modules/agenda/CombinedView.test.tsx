import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CombinedView } from "./CombinedView";
import { makeItem, makeWorkshopItem } from "./items.fixture";

describe("CombinedView", () => {
  it("shows the day's appointments and the in-workshop list, appointments first", () => {
    render(<CombinedView date="2026-10-26" items={[makeItem({ customerName: "Cita Uno" })]} workshop={[makeWorkshopItem({ customerName: "Taller Uno" })]} workshopTruncated={false} />);
    const day = screen.getByRole("region", { name: "Citas del día" });
    const shop = screen.getByRole("region", { name: "En el taller ahora" });
    expect(within(day).getByText("Cita Uno")).toBeInTheDocument();
    expect(within(shop).getByText("Taller Uno")).toBeInTheDocument();
    expect(day.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the day column is the hour grid: cards are buttons and selection is reported", async () => {
    const onSelect = vi.fn();
    render(<CombinedView date="2026-10-26" items={[makeItem({ id: "c1", customerName: "Cita Uno" })]} workshop={[]} workshopTruncated={false} selectedId="c1" onSelect={onSelect} />);
    expect(screen.getByText("08:00")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /Cita Uno/ });
    expect(card).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), card);
  });

  it("Side by side and stacked: one column on phone and tablet portrait, two from lg", () => {
    const { container } = render(<CombinedView date="2026-10-26" items={[]} workshop={[]} workshopTruncated={false} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("lg:grid-cols-2");
  });

  it("Panel heading: 'En el taller ahora' with a count badge outside the heading, so the region keeps its name", () => {
    render(<CombinedView date="2026-10-26" items={[]} workshop={[makeWorkshopItem({ id: "a" }), makeWorkshopItem({ id: "b" })]} workshopTruncated={false} />);
    const shop = screen.getByRole("region", { name: "En el taller ahora" });
    expect(within(shop).getByRole("heading", { name: "En el taller ahora" })).toBeInTheDocument();
    expect(within(shop).getByTestId("workshop-count")).toHaveTextContent("2");
  });

  it("Technicians on the card: the card shows the dot, plate + make model, name, status, since-time and initials; no phone; links to the order at 44px", () => {
    render(
      <CombinedView
        date="2026-10-26"
        items={[]}
        workshop={[makeWorkshopItem({ id: "w9", status: "diagnosing", statusLabel: "En diagnóstico", categoria: "instalacion", sinceLabel: "2 h 40 min", technicianInitials: "MP JR" })]}
        workshopTruncated={false}
      />,
    );
    const card = screen.getByRole("link", { name: /Pérez/ });
    expect(card).toHaveAttribute("href", "/service-orders/w9");
    expect(card.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(card.className).toMatch(/(^|\s)min-w-11(\s|$)/);
    expect(card.querySelector(".agenda-dot")).toHaveAttribute("data-categoria", "instalacion");
    for (const text of ["AB1234 · Toyota Hilux", "Pérez", "En diagnóstico", "2 h 40 min", "MP JR"]) expect(within(card).getByText(text)).toBeInTheDocument();
    expect(card.textContent).not.toContain("61234567");
  });

  it("A card without type or technicians: a neutral dot, 'Sin vehículo' and 'Sin técnico'", () => {
    render(<CombinedView date="2026-10-26" items={[]} workshop={[makeWorkshopItem({ categoria: null, vehicleLabel: "Sin vehículo" })]} workshopTruncated={false} />);
    const card = screen.getByRole("link", { name: /Pérez/ });
    expect(card.querySelector(".agenda-dot")).toHaveAttribute("data-categoria", "none");
    expect(within(card).getByText("Sin vehículo")).toBeInTheDocument();
    expect(within(card).getByText("Sin técnico")).toBeInTheDocument();
  });

  it("Hold reason shown only while on hold: reason and 'hace 2 días' on the on_hold card, nothing on the others, even one carrying a stray reason", () => {
    render(
      <CombinedView
        date="2026-10-26"
        items={[]}
        workshop={[
          makeWorkshopItem({ id: "h", customerName: "Espera", status: "on_hold", statusLabel: "En espera", holdReason: "Repuesto", holdSinceLabel: "hace 2 días" }),
          makeWorkshopItem({ id: "p", customerName: "Progreso", status: "in_progress", statusLabel: "En progreso", holdReason: "Repuesto", holdSinceLabel: "hace 2 días" }),
        ]}
        workshopTruncated={false}
      />,
    );
    const held = screen.getByRole("link", { name: /Espera/ });
    expect(within(held).getByText("Repuesto · hace 2 días").className).toContain("amber");
    expect(screen.getAllByText(/Repuesto/)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Progreso/ })).not.toHaveTextContent("Repuesto");
  });

  it("empty states and the truncation notice", () => {
    const { rerender } = render(<CombinedView date="2026-10-26" items={[]} workshop={[]} workshopTruncated={false} />);
    expect(screen.getByText("Sin citas para este día")).toBeInTheDocument();
    expect(screen.getByText("Sin órdenes en el taller")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<CombinedView date="2026-10-26" items={[]} workshop={[]} workshopTruncated />);
    expect(screen.getByRole("status")).toHaveTextContent("Se muestran las primeras 500 órdenes en el taller.");
  });
});
