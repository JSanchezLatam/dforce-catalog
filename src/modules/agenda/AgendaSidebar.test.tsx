import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgendaSidebar } from "./AgendaSidebar";

const counts = { instalacion: 0, mant_preventivo: 1, mant_correctivo: 0, reparacion: 2, revisado: 4, none: 2 };
const summary = [
  { label: "Agendadas", count: 5 },
  { label: "Recibidas", count: 3 },
  { label: "Vencidas", count: 2 },
  { label: "No se presentó", count: 1 },
];
const base = { counts, hidden: [] as never[], summary, onToggle: vi.fn(), onAll: vi.fn() };

describe("AgendaSidebar", () => {
  it("lists, in order: the calendar slot, the Próxima cita slot, Categoría and Esta semana", () => {
    render(<AgendaSidebar {...base} calendar={<div>CAL</div>} next={<div>NEXT</div>} />);
    const text = document.body.textContent ?? "";
    const order = ["CAL", "NEXT", "Categoría", "Esta semana"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Type counts: six checkboxes, all checked, each with its label and count", () => {
    render(<AgendaSidebar {...base} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(6);
    for (const box of boxes) expect(box).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /REVISADO/ })).toHaveAccessibleName("REVISADO 4");
    expect(screen.getByRole("checkbox", { name: /Sin categoría/ })).toHaveAccessibleName("Sin categoría 2");
    expect(screen.getByRole("checkbox", { name: /Instalación/ })).toHaveAccessibleName("Instalación 0");
  });

  it("each row carries the colour dot of its type", () => {
    const { container } = render(<AgendaSidebar {...base} />);
    const dots = [...container.querySelectorAll(".agenda-dot")].map((d) => d.getAttribute("data-categoria"));
    expect(dots).toEqual(["instalacion", "mant_preventivo", "mant_correctivo", "reparacion", "revisado", "none"]);
  });

  it("an unchecked type shows unchecked, and clicking a row reports its key", async () => {
    const onToggle = vi.fn();
    render(<AgendaSidebar {...base} hidden={["revisado"]} onToggle={onToggle} />);
    expect(screen.getByRole("checkbox", { name: /REVISADO/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: /Reparación/ }));
    expect(onToggle).toHaveBeenCalledWith("reparacion");
  });

  it("Todos resets: the control reports it and is a 44px target", async () => {
    const onAll = vi.fn();
    render(<AgendaSidebar {...base} hidden={["revisado", "none"]} onAll={onAll} />);
    const todos = screen.getByRole("button", { name: "Todos" });
    expect(todos.className).toContain("min-h-11");
    expect(todos.className).toContain("min-w-11");
    await userEvent.click(todos);
    expect(onAll).toHaveBeenCalledTimes(1);
  });

  it("Esta semana shows each label with its count", () => {
    render(<AgendaSidebar {...base} />);
    const week = screen.getByRole("region", { name: "Esta semana" });
    for (const { label, count } of summary) expect(within(week).getByText(label).parentElement).toHaveTextContent(`${label}${count}`);
  });

  it("Esta semana draws a thin bar per row, as wide as its count is relative to the largest, and aria-hidden", () => {
    const { container } = render(<AgendaSidebar {...base} />);
    const bars = [...container.querySelectorAll("[data-bar]")] as HTMLElement[];
    expect(bars.map((b) => b.style.width)).toEqual(["100%", "60%", "40%", "20%"]);
    for (const bar of bars) expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("an all-zero week draws empty bars, not NaN", () => {
    const { container } = render(<AgendaSidebar {...base} summary={summary.map((r) => ({ ...r, count: 0 }))} />);
    expect([...container.querySelectorAll("[data-bar]")].map((b) => (b as HTMLElement).style.width)).toEqual(["0%", "0%", "0%", "0%"]);
  });

  it("Column collapses behind Filtros: a 44x44 disclosure button toggles the column below lg", async () => {
    render(<AgendaSidebar {...base} />);
    const button = screen.getByRole("button", { name: "Filtros" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
    expect(button.className).toContain("lg:hidden");
    const column = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(column.className).toContain("hidden lg:flex");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(column.className).not.toContain("hidden");
    expect(column).toContainElement(screen.getByRole("heading", { name: "Categoría" }));
  });
});
