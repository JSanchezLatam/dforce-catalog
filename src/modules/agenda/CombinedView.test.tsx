import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CombinedView } from "./CombinedView";
import { makeItem, makeWorkshopItem } from "./items.fixture";

describe("CombinedView", () => {
  it("shows the day's appointments and the in-workshop list, appointments first", () => {
    render(<CombinedView date="2026-10-26" items={[makeItem({ customerName: "Cita Uno" })]} workshop={[makeWorkshopItem({ customerName: "Taller Uno" })]} workshopTruncated={false} />);
    const day = screen.getByRole("region", { name: "Citas del día" });
    const shop = screen.getByRole("region", { name: "En el taller" });
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
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("Side by side and stacked: one column on phone and tablet portrait, two from lg", () => {
    const { container } = render(<CombinedView date="2026-10-26" items={[]} workshop={[]} workshopTruncated={false} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("lg:grid-cols-2");
  });

  it("an in-workshop row: badge, name, phone, plate, link to the order, 44px target", () => {
    render(<CombinedView date="2026-10-26" items={[]} workshop={[makeWorkshopItem({ id: "w9", status: "diagnosing", statusLabel: "En diagnóstico" })]} workshopTruncated={false} />);
    const row = screen.getByRole("link", { name: /Pérez/ });
    expect(row).toHaveAttribute("href", "/service-orders/w9");
    expect(row.textContent).toMatch(/Pérez.*61234567.*AB1234/);
    expect(within(row).getByText("En diagnóstico")).toBeInTheDocument();
    expect(row.className).toContain("min-h-11");
  });

  it("Hold reason shown only while on hold: rendered when the item carries it, absent otherwise", () => {
    render(
      <CombinedView
        date="2026-10-26"
        items={[]}
        workshop={[
          makeWorkshopItem({ id: "h", customerName: "Espera", status: "on_hold", statusLabel: "En espera", holdReason: "Repuesto" }),
          makeWorkshopItem({ id: "p", customerName: "Progreso", status: "in_progress", statusLabel: "En progreso" }),
        ]}
        workshopTruncated={false}
      />,
    );
    expect(screen.getByRole("link", { name: /Espera/ }).textContent).toContain("Repuesto");
    expect(screen.getAllByText("Repuesto")).toHaveLength(1);
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
