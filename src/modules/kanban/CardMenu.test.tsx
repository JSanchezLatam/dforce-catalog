import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardMenu, menuItems } from "./CardMenu";
import type { KanbanCard } from "./shape";

// A wire-shaped card (kanban/shape.ts); a test overrides only what it is about.
const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "ord-1", status: "in_progress", statusLabel: "En progreso", plate: "AB1234", make: "Toyota", model: "Hilux", holdReason: null,
  technicians: [], statusSince: "2026-10-26T14:48:00.000Z", urgent: false, categoria: null, missing: [], mine: false, ...over,
});
const open = async (c: KanbanCard, canMove: boolean) => {
  const onMove = vi.fn();
  render(<CardMenu card={c} canMove={canMove} onMove={onMove} onUrgent={onUrgent} />);
  await userEvent.click(screen.getByRole("button", { name: "Acciones de la orden" }));
  return onMove;
};
const onUrgent = vi.fn();
// The viewport is read in the click, so a test sets it before opening the menu.
const narrow = (on: boolean) => vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ matches: on && q === "(max-width: 767px)" }) as MediaQueryList);
afterEach(() => (vi.restoreAllMocks(), onUrgent.mockClear()));
const labels = async () => (await screen.findAllByRole("menuitem")).map((i) => i.textContent);

describe("menuItems", () => {
  it("offers drop targets without cancelled, and cancel only while the order can still be cancelled", () => {
    expect(menuItems({ status: "in_progress", urgent: false }, true)).toEqual({ targets: ["on_hold", "done"], cancel: true, urgent: "mark" });
    expect(menuItems({ status: "done", urgent: false }, true)).toEqual({ targets: [], cancel: false, urgent: null });
    expect(menuItems({ status: "in_progress", urgent: false }, false)).toEqual({ targets: [], cancel: false, urgent: null });
  });

  it("offers the urgent toggle in the direction of the card's flag, and never on a closed order", () => {
    expect(menuItems({ status: "open", urgent: true }, true).urgent).toBe("clear");
    expect(menuItems({ status: "open", urgent: false }, true).urgent).toBe("mark");
    expect(menuItems({ status: "done", urgent: true }, true).urgent).toBeNull();
    expect(menuItems({ status: "open", urgent: true }, false).urgent).toBeNull();
  });
});

describe("CardMenu", () => {
  it("lists Mover a…, Ver orden and a danger Cancelar orden, and the submenu moves to the chosen target", async () => {
    const onMove = await open(card(), true);
    expect(await labels()).toEqual(["Mover a…", "Marcar como urgente", "Ver orden", "Cancelar orden"]);
    expect(screen.getByRole("menuitem", { name: "Ver orden" })).toHaveAttribute("href", "/service-orders/ord-1");
    expect(screen.getByRole("menuitem", { name: "Cancelar orden" })).toHaveAttribute("data-variant", "destructive");
    await userEvent.click(screen.getByRole("menuitem", { name: "Mover a…" }));
    expect(await screen.findByText("Mover AB1234 a…")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Completada" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("done");
  });

  it("omits Mover a… when no target is legal, and Cancelar orden still reports cancelled", async () => {
    const onMove = await open(card({ status: "open" }), true);
    expect(await labels()).toEqual(["Marcar como urgente", "Ver orden", "Cancelar orden"]);
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

  it("Marcar como urgente reports true", async () => {
    await open(card(), true);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Marcar como urgente" }));
    expect(onUrgent).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("Quitar urgente on an urgent card reports false", async () => {
    await open(card({ urgent: true }), true);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Quitar urgente" }));
    expect(onUrgent).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("a done card has no toggle", async () => {
    await open(card({ status: "done", urgent: true }), true);
    expect(await labels()).toEqual(["Ver orden"]);
  });

  it("a narrow viewport opens the bottom sheet instead of the menu, and a wide one the menu", async () => {
    narrow(true);
    await open(card(), true);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("a wide viewport opens the menu and no sheet", async () => {
    narrow(false);
    await open(card(), true);
    expect(await screen.findAllByRole("menuitem")).not.toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
