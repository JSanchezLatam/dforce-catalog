import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgendaHeader } from "./AgendaHeader";

const base = { view: "week" as const, date: "2026-10-26", today: "2026-10-28", truncated: false, onNew: () => {} };

describe("AgendaHeader", () => {
  it("Navigation links: previous, next and Hoy are plain links that rewrite the query", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/agenda?view=week&date=2026-10-19");
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/agenda?view=week&date=2026-11-02");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("href", "/agenda?view=week&date=2026-10-28");
  });

  it("Navigation links: the view switcher keeps the selected date", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("link", { name: "Día" })).toHaveAttribute("href", "/agenda?view=day&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("href", "/agenda?view=month&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Combinada" })).toHaveAttribute("href", "/agenda?view=combined&date=2026-10-26");
    expect(screen.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");
  });

  it("Hit targets classes: every link is at least 44x44", () => {
    render(<AgendaHeader {...base} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-11");
    }
  });

  it("Header layout: breadcrumb, title, subtitle and the month the toolbar is on", () => {
    render(<AgendaHeader {...base} />);
    const crumbs = screen.getByRole("navigation", { name: "Ruta" });
    expect(crumbs).toHaveTextContent("Taller / Agenda");
    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("Citas del taller y órdenes en curso")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Octubre 2026" })).toBeInTheDocument();
  });

  it("Header layout: the search field sits in the title row, beside the booking button", () => {
    render(<AgendaHeader {...base} search={<input aria-label="Buscar" />} tabs={<div role="tablist" aria-label="Citas" />} />);
    const search = screen.getByRole("textbox", { name: "Buscar" });
    expect(search.parentElement).toContainElement(screen.getByRole("button", { name: "Nueva cita" }));
    expect(screen.getByRole("tablist", { name: "Citas" })).toBeInTheDocument();
  });

  it("Header trigger: 'Nueva cita' stays the primary variant and keeps the 44px class", () => {
    render(<AgendaHeader {...base} />);
    const button = screen.getByRole("button", { name: "Nueva cita" });
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("min-h-11");
  });

  it("Compact on a phone: the floating button replaces 'Nueva cita', and the breadcrumb, subtitle and range pill hide below md", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("button", { name: "Nueva cita" }).className).toContain("max-md:hidden");
    expect(screen.getByRole("navigation", { name: "Ruta" }).className).toContain("max-md:hidden");
    expect(screen.getByText("Citas del taller y órdenes en curso").className).toContain("max-md:hidden");
    expect(screen.getByText("Semana del 26/10/2026").className).toContain("max-md:hidden");
  });

  it("Phone: Actualizar is icon-only (still named), the view links tighten, and the filters control sits on the view row beside the refresh", () => {
    render(<AgendaHeader {...base} filters={<button type="button" aria-label="Filtros" />} />);
    const refresh = screen.getByRole("button", { name: "Actualizar" });
    expect(screen.getByText("Actualizar").className).toContain("max-md:sr-only");
    const row = screen.getByRole("navigation", { name: "Vista" }).parentElement!;
    expect(row).toContainElement(refresh);
    expect(row).toContainElement(screen.getByRole("button", { name: "Filtros" }));
    for (const link of within(screen.getByRole("navigation", { name: "Vista" })).getAllByRole("link")) expect(link.className).toContain("max-md:px-2");
  });

  it("Manual refresh: the existing RefreshListButton is there", () => {
    render(<AgendaHeader {...base} />);
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeInTheDocument();
  });

  it("Row cap disclosure: the notice renders only when truncated", () => {
    const { rerender } = render(<AgendaHeader {...base} />);
    expect(screen.queryByText("Se muestran las primeras 500 citas; acotá el rango.")).not.toBeInTheDocument();
    rerender(<AgendaHeader {...base} truncated />);
    expect(screen.getByText("Se muestran las primeras 500 citas; acotá el rango.")).toBeInTheDocument();
  });

  it("labels the range with digits only", () => {
    const { rerender } = render(<AgendaHeader {...base} />);
    expect(screen.getByText("Semana del 26/10/2026")).toBeInTheDocument();
    rerender(<AgendaHeader {...base} view="month" />);
    expect(screen.getByText("10/2026")).toBeInTheDocument();
    rerender(<AgendaHeader {...base} view="day" />);
    expect(screen.getByText("26/10/2026")).toBeInTheDocument();
  });

  it("Booking trigger: 'Nueva cita' only asks the shell to open the dialog; the header owns no dialog", async () => {
    const onNew = vi.fn();
    render(<AgendaHeader {...base} onNew={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: "Nueva cita" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
