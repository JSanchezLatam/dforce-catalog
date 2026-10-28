import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmMoveDialog } from "./ConfirmMoveDialog";
import { EsperaDialog } from "./EsperaDialog";
import { IncompleteDialog } from "./IncompleteDialog";
import type { KanbanCard } from "./shape";

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "ord-1", status: "in_progress", statusLabel: "En progreso", plate: "AB1234", make: "Toyota", model: "Hilux", holdReason: null,
  technicians: [], statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});

describe("OrderLine", () => {
  const noVehicle = { plate: "Sin vehículo", make: null, model: null, missing: ["vehiculo" as const] };
  it("reads Sin placa for an order with no vehicle, in the confirm and the espera dialogs", () => {
    const { unmount } = render(<ConfirmMoveDialog card={card(noVehicle)} target="done" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Sin placa")).toBeInTheDocument();
    expect(screen.queryByText("Sin vehículo")).toBeNull();
    unmount();
    render(<EsperaDialog card={card(noVehicle)} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Sin placa")).toBeInTheDocument();
  });
});

describe("EsperaDialog", () => {
  it("keeps Pasar a En espera disabled until a reason is chosen, then confirms with that reason", async () => {
    const onConfirm = vi.fn();
    render(<EsperaDialog card={card()} onConfirm={onConfirm} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "¿Por qué queda en espera?" })).toBeInTheDocument();
    expect(screen.getByText("Falta que llegue una pieza")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Pasar a En espera" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Aprobación del cliente/ }));
    expect(screen.getByRole("button", { name: /Aprobación del cliente/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("aprobacion_cliente");
  });

  it("Cancelar and Escape only close", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<EsperaDialog card={card()} onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ConfirmMoveDialog", () => {
  const cases = [
    ["in_progress", "done", "¿Marcar la orden como Completada?", "Sí, completar", "Cancelar"],
    ["ready_for_review", "in_progress", "¿Devolver la orden a En progreso?", "Sí, devolver", "Cancelar"],
    ["in_progress", "cancelled", "¿Cancelar la orden?", "Sí, cancelar orden", "Volver"],
  ] as const;
  it.each(cases)("%s -> %s asks %s", async (from, to, title, yes, no) => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmMoveDialog card={card({ status: from })} target={to} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: no }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: yes }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("styles only the cancellation as danger", () => {
    const { unmount } = render(<ConfirmMoveDialog card={card()} target="cancelled" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sí, cancelar orden" }).className).toMatch(/text-red-700/);
    unmount();
    render(<ConfirmMoveDialog card={card()} target="done" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sí, completar" }).className).not.toMatch(/text-red-700/);
  });
});

describe("IncompleteDialog", () => {
  it("lists only what is missing as sin cargar and links Editar orden to the order", async () => {
    const onClose = vi.fn();
    render(<IncompleteDialog card={card({ status: "booked", missing: ["categoria"] })} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Todavía no se puede recibir" })).toHaveTextContent("Completá el vehículo y la categoría antes de recibir la orden.");
    expect(screen.getByText("Categoría").parentElement).toHaveTextContent("sin cargar");
    expect(screen.queryByText("Vehículo")).toBeNull();
    expect(screen.getByRole("link", { name: "Editar orden" })).toHaveAttribute("href", "/service-orders/ord-1");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
