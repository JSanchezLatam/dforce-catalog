import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";

import { AgendaDetail } from "./AgendaDetail";
import { makeItem } from "./items.fixture";

const jorge = (over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({
    id: "o1",
    dayKey: "2026-10-27",
    time: "11:00",
    customerName: "Jorge Vega",
    customerPhone: "6612-4480",
    vehicleLabel: "AC 5521 · Toyota Corolla",
    vehicleDetail: "AC 5521 · Toyota Corolla 2019",
    categoria: "revisado",
    categoriaLabel: "REVISADO",
    description: "Revisado + alineación",
    technicians: [{ id: "t1", nombre: "Julio Rangel", initials: "JR" }],
    ...over,
  });

const chips = () => within(screen.getByRole("list", { name: "Categoría" })).getAllByRole("listitem");

describe("AgendaDetail", () => {
  it("Detail content: a booked appointment that is not Vencida", () => {
    render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
    expect(screen.getByText("Cita agendada")).toBeInTheDocument();
    expect(screen.getByText("Jorge Vega")).toBeInTheDocument();
    expect(screen.getByText("Martes 27 de octubre")).toBeInTheDocument();
    expect(screen.getByText("11:00")).toBeInTheDocument();
    expect(screen.getByText("AC 5521 · Toyota Corolla 2019")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "6612-4480" })).toHaveAttribute("href", "tel:6612-4480");
    expect(screen.getByText("Revisado + alineación")).toBeInTheDocument();
    expect(chips().map((c) => c.textContent)).toEqual(Object.values(CATEGORIA_LABEL));
    expect(chips().filter((c) => c.getAttribute("aria-current") === "true").map((c) => c.textContent)).toEqual(["REVISADO"]);
    expect(screen.getByText("Julio Rangel")).toBeInTheDocument();
    expect(screen.getByText("JR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
  });

  it("the phone link carries the digits as they are stored", () => {
    render(<AgendaDetail item={jorge({ customerPhone: "61234567" })} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: "61234567" })).toHaveAttribute("href", "tel:61234567");
  });

  it("Abrir orden: a 44px link to the order, as a button and as the pencil with the same accessible name", () => {
    render(<AgendaDetail item={jorge({ href: "/service-orders/o1" })} onClose={vi.fn()} />);
    const links = screen.getAllByRole("link", { name: "Abrir orden" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/service-orders/o1");
      expect(link).toHaveClass("min-h-11", "min-w-11");
    }
    expect(links.some((l) => l.textContent === "Abrir orden")).toBe(true);
    expect(links.some((l) => l.querySelector("svg"))).toBe(true);
  });

  it("Vencida Detail offers both actions, and its status reads Vencida", () => {
    render(<AgendaDetail item={jorge({ overdue: true })} onClose={vi.fn()} />);
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.queryByText("Cita agendada")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
  });

  it("Muted Detail is read-only: an open appointment offers Abrir orden only, and shows its chips and technicians", () => {
    render(<AgendaDetail item={jorge({ status: "open", statusLabel: "Recibida", muted: true })} onClose={vi.fn()} />);
    expect(screen.getByText("Recibida")).toBeInTheDocument();
    expect(chips()).toHaveLength(5);
    expect(screen.getByText("Julio Rangel")).toBeInTheDocument();
    // The only buttons are the close control: no action, no chip, no assign control.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar"]);
    expect(screen.getAllByRole("link", { name: "Abrir orden" })).toHaveLength(2);
  });

  it("a no-show reads 'No se presentó' and offers Abrir orden only", () => {
    render(<AgendaDetail item={jorge({ status: "cancelled", statusLabel: "No se presentó", muted: true, noShow: true })} onClose={vi.fn()} />);
    expect(screen.getByText("No se presentó")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar"]);
  });

  it("empty fields: 'Sin descripción', 'Sin vehículo', 'Sin técnico' and no chip marked", () => {
    render(<AgendaDetail item={jorge({ description: null, vehicleDetail: "Sin vehículo", categoria: null, categoriaLabel: "Sin categoría", technicians: [] })} onClose={vi.fn()} />);
    expect(screen.getByText("Sin descripción")).toBeInTheDocument();
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
    expect(screen.getByText("Sin técnico")).toBeInTheDocument();
    expect(chips().filter((c) => c.getAttribute("aria-current") === "true")).toHaveLength(0);
  });

  it("an empty description is also 'Sin descripción' when it is only spaces", () => {
    render(<AgendaDetail item={jorge({ description: "   " })} onClose={vi.fn()} />);
    expect(screen.getByText("Sin descripción")).toBeInTheDocument();
  });

  it("Close control: a 44x44 'Cerrar' that reports the close", async () => {
    const onClose = vi.fn();
    render(<AgendaDetail item={jorge()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(close).toHaveClass("min-h-11", "min-w-11");
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Reprogramar opens the existing dialog", async () => {
    render(<AgendaDetail item={jorge()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Reprogramar" }));
    expect(screen.getByRole("dialog", { name: "Reprogramar cita" })).toBeInTheDocument();
  });

  it("No se presentó opens the existing confirmation", async () => {
    render(<AgendaDetail item={jorge({ overdue: true })} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "No se presentó" }));
    expect(screen.getByRole("dialog", { name: "¿El cliente no se presentó?" })).toBeInTheDocument();
  });
});
