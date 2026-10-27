import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MoveSheet } from "./MoveSheet";
import type { KanbanCard } from "./shape";

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "ord-1", status: "in_progress", statusLabel: "En progreso", plate: "AB1234", make: "Toyota", model: "Hilux", holdReason: null,
  technicians: [], statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
const setup = (c: KanbanCard, canMove = true) => {
  const fns = { onClose: vi.fn(), onMove: vi.fn(), onUrgent: vi.fn() };
  render(<MoveSheet card={c} canMove={canMove} open {...fns} />);
  return fns;
};
const names = () => screen.getAllByRole("button").concat(screen.getAllByRole("link")).map((e) => e.textContent);

describe("MoveSheet", () => {
  it("is a bottom sheet headed by the plate and the status", () => {
    setup(card());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "bottom");
    expect(screen.getByRole("heading", { name: "AB1234" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Toyota · Hilux · En progreso");
  });

  it("lists the legal targets under Mover a, then the urgent toggle, Ver orden and Cancelar orden", () => {
    setup(card());
    expect(screen.getByRole("group", { name: "Mover a" })).toBeInTheDocument();
    expect(names()).toEqual(expect.arrayContaining(["En espera", "Completada", "Marcar como urgente", "Ver orden", "Cancelar orden"]));
    expect(screen.getByRole("link", { name: "Ver orden" })).toHaveAttribute("href", "/service-orders/ord-1");
  });

  it("a target reports itself and closes the sheet; the toggle and cancel do the same", async () => {
    const { onClose, onMove, onUrgent } = setup(card({ urgent: true }));
    await userEvent.click(screen.getByRole("button", { name: "Completada" }));
    expect(onMove).toHaveBeenLastCalledWith("done");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar orden" }));
    expect(onMove).toHaveBeenLastCalledWith("cancelled");
    await userEvent.click(screen.getByRole("button", { name: "Quitar urgente" }));
    expect(onUrgent).toHaveBeenCalledExactlyOnceWith(false);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("a técnico gets only Ver orden; a done card gets no toggle", () => {
    setup(card(), false);
    expect(screen.queryByRole("group", { name: "Mover a" })).toBeNull();
    expect(screen.queryByRole("button", { name: /urgente|Cancelar orden/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver orden" })).toBeInTheDocument();
  });

  it("a done card offers no toggle even for the jefe", () => {
    setup(card({ status: "done", statusLabel: "Completada", urgent: true }));
    expect(screen.queryByRole("button", { name: /urgente/ })).toBeNull();
  });

  it("every action row is at least 44px tall", () => {
    setup(card());
    for (const row of [...screen.getByRole("group", { name: "Mover a" }).querySelectorAll("button"), screen.getByRole("link", { name: "Ver orden" }), screen.getByRole("button", { name: "Cerrar" })])
      expect(row).toHaveClass(row.getAttribute("aria-label") === "Cerrar" ? "size-11" : "min-h-11");
  });
});
