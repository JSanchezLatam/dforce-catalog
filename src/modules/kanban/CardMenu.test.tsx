import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardMenu, menuItems } from "./CardMenu";
import type { KanbanCard } from "./shape";

// A wire-shaped card (kanban/shape.ts); a test overrides only what it is about.
const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "ord-1", status: "in_progress", statusLabel: "En progreso", plate: "AB1234", make: "Toyota", model: "Hilux", holdReason: null,
  technicians: [], statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
const open = async (c: KanbanCard, canMove: boolean) => {
  const onMove = vi.fn();
  render(<CardMenu card={c} canMove={canMove} onMove={onMove} />);
  await userEvent.click(screen.getByRole("button", { name: "Acciones de la orden" }));
  return onMove;
};
const labels = async () => (await screen.findAllByRole("menuitem")).map((i) => i.textContent);

describe("menuItems", () => {
  it("offers drop targets without cancelled, and cancel only while the order can still be cancelled", () => {
    expect(menuItems({ status: "in_progress" }, true)).toEqual({ targets: ["on_hold", "done"], cancel: true });
    expect(menuItems({ status: "done" }, true)).toEqual({ targets: [], cancel: false });
    expect(menuItems({ status: "in_progress" }, false)).toEqual({ targets: [], cancel: false });
  });
});

describe("CardMenu", () => {
  it("lists Mover a…, Ver orden and a danger Cancelar orden, and the submenu moves to the chosen target", async () => {
    const onMove = await open(card(), true);
    expect(await labels()).toEqual(["Mover a…", "Ver orden", "Cancelar orden"]);
    expect(screen.getByRole("menuitem", { name: "Ver orden" })).toHaveAttribute("href", "/service-orders/ord-1");
    expect(screen.getByRole("menuitem", { name: "Cancelar orden" })).toHaveAttribute("data-variant", "destructive");
    await userEvent.click(screen.getByRole("menuitem", { name: "Mover a…" }));
    expect(await screen.findByText("Mover AB1234 a…")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Completada" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("done");
  });

  it("omits Mover a… when no target is legal, and Cancelar orden still reports cancelled", async () => {
    const onMove = await open(card({ status: "open" }), true);
    expect(await labels()).toEqual(["Ver orden", "Cancelar orden"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Cancelar orden" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("cancelled");
  });

  it("a técnico (canMove false) sees only Ver orden", async () => {
    await open(card(), false);
    expect(await labels()).toEqual(["Ver orden"]);
  });

  it("every menu row is at least 44px tall and the trigger is 44x44", async () => {
    await open(card(), true);
    for (const i of await screen.findAllByRole("menuitem")) expect(i).toHaveClass("min-h-11");
    expect(within(document.body).getByRole("button", { name: "Acciones de la orden" })).toHaveClass("size-11");
  });
});
