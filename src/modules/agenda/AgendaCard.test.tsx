import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { AgendaCard } from "./AgendaCard";
import { makeItem } from "./items.fixture";

const jorge = () =>
  makeItem({
    id: "o1",
    time: "11:00",
    customerName: "Jorge Vega",
    customerPhone: "61234567",
    vehicleLabel: "AC 5521 · Toyota Corolla",
    categoria: "revisado",
    categoriaLabel: "REVISADO",
    description: "Revisado + alineación",
    technicians: [{ id: "t1", nombre: "Julio Rangel", initials: "JR" }],
  });

describe("AgendaCard", () => {
  it("Card fields: strip, name, vehicle and initials; no status, phone or description", () => {
    render(<AgendaCard item={jorge()} />);
    expect(screen.getByText("11:00 · REVISADO")).toBeInTheDocument();
    expect(screen.getByText("Jorge Vega")).toBeInTheDocument();
    expect(screen.getByText("AC 5521 · Toyota Corolla")).toBeInTheDocument();
    expect(screen.getByText("JR")).toBeInTheDocument();
    expect(screen.queryByText("Agendada")).not.toBeInTheDocument();
    expect(screen.queryByText("Vencida")).not.toBeInTheDocument();
    expect(screen.queryByText(/61234567/)).not.toBeInTheDocument();
    expect(screen.queryByText(/alineación/)).not.toBeInTheDocument();
  });

  it("labels come from the item, not from the card", () => {
    render(<AgendaCard item={makeItem({ time: "09:30", categoriaLabel: "Etiqueta del item" })} />);
    expect(screen.getByText("09:30 · Etiqueta del item")).toBeInTheDocument();
  });

  it("No vehicle, no type, no technician: the placeholders, and the neutral hook", () => {
    render(<AgendaCard item={makeItem({ categoria: null, categoriaLabel: "Sin categoría", vehicleLabel: "Sin vehículo", technicians: [] })} />);
    expect(screen.getByText("14:05 · Sin categoría")).toBeInTheDocument();
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
    expect(screen.getByText("Sin técnico")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("data-categoria", "none");
  });

  it("Colour follows the type: five typed cards carry five distinct hooks", () => {
    const cats = ["instalacion", "mant_preventivo", "mant_correctivo", "reparacion", "revisado"] as const;
    const hooks = cats.map((categoria) => {
      const { container, unmount } = render(<AgendaCard item={makeItem({ categoria })} />);
      const hook = container.querySelector("button")!.getAttribute("data-categoria");
      unmount();
      return hook;
    });
    expect(hooks).toEqual([...cats]);
    expect(new Set(hooks).size).toBe(5);
  });

  it("Status is text as well as colour: Recibida, Completada, Vencida, No se presentó", () => {
    const cases: [Parameters<typeof makeItem>[0], string][] = [
      [{ status: "open", statusLabel: "Recibida", muted: true }, "Recibida"],
      [{ status: "done", statusLabel: "Completada", muted: true }, "Completada"],
      [{ status: "booked", statusLabel: "Agendada", overdue: true }, "Vencida"],
      [{ status: "cancelled", statusLabel: "No se presentó", muted: true, noShow: true }, "No se presentó"],
    ];
    for (const [over, text] of cases) {
      const { unmount } = render(<AgendaCard item={makeItem(over)} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it("a no-show strikes the name through; a plain card does not", () => {
    const { unmount } = render(<AgendaCard item={makeItem({ status: "cancelled", statusLabel: "No se presentó", muted: true, noShow: true })} />);
    expect(screen.getByText("Pérez")).toHaveClass("line-through");
    unmount();
    render(<AgendaCard item={makeItem()} />);
    expect(screen.getByText("Pérez")).not.toHaveClass("line-through");
  });

  it("a statused card with no technician shows no 'Sin técnico'", () => {
    render(<AgendaCard item={makeItem({ status: "open", statusLabel: "Recibida", muted: true })} />);
    expect(screen.queryByText("Sin técnico")).not.toBeInTheDocument();
  });

  it("is a button named by time and customer, 44px tall, pressed only when selected", () => {
    const { rerender } = render(<AgendaCard item={jorge()} />);
    const button = screen.getByRole("button", { name: /11:00.*Jorge Vega/ });
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName(expect.stringContaining("Julio Rangel"));
    expect(button).toHaveAccessibleName(expect.stringContaining("REVISADO"));
    rerender(<AgendaCard item={jorge()} selected />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("activating the card reports its item", async () => {
    const onSelect = vi.fn();
    render(<AgendaCard item={jorge()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }));
  });

  it("icons are decoration: the vehicle line and each status pill carry an aria-hidden svg beside their text", () => {
    const { container, unmount } = render(<AgendaCard item={makeItem()} />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("AB1234 · Toyota Corolla").previousElementSibling?.tagName.toLowerCase()).toBe("svg");
    unmount();
    const cases: [Parameters<typeof makeItem>[0], string][] = [
      [{ status: "open", statusLabel: "Recibida", muted: true }, "Recibida"],
      [{ status: "booked", overdue: true }, "Vencida"],
      [{ status: "cancelled", statusLabel: "No se presentó", muted: true, noShow: true }, "No se presentó"],
    ];
    for (const [over, text] of cases) {
      const view = render(<AgendaCard item={makeItem(over)} />);
      const pill = screen.getByText(text);
      expect(pill.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      view.unmount();
    }
  });
});
