import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TechnicianMonthTable } from "./TechnicianMonthTable";

const row = (nombre: string, closed: number, hours: number) => ({ tecnicoId: nombre, nombre, closed, hours });

describe("TechnicianMonthTable", () => {
  it("has the three columns and shows closed orders and hours with one decimal", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 3, 4.5)]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians={false} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Técnico", "Órdenes cerradas", "Horas"]);
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["Luis", "3", "4.5 h"]);
  });

  it("rounds hours to one decimal", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 1, 1.25)]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("1.3 h")).toBeInTheDocument();
  });

  it("sorts by closed orders, then hours, both descending", () => {
    render(
      <TechnicianMonthTable
        rows={[row("Ana", 1, 9), row("Beto", 3, 1), row("Carla", 3, 2)]}
        mes="2026-10"
        mesLabel="Octubre 2026"
        canManageTechnicians={false}
      />,
    );

    const names = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Carla", "Beto", "Ana"]);
  });

  it("says a shared order counts for every assignee", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 3, 4.5)]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("Una orden con varios técnicos cuenta para cada uno.")).toBeInTheDocument();
  });

  it("teaches what counts when the month has no closed orders, and still lists the roster", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 0, 0)]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("Todavía no hay órdenes cerradas en Octubre 2026. Una orden cuenta cuando pasa a Completada.")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("explains an empty roster and links to Técnicos only for who can manage them", () => {
    const { rerender } = render(<TechnicianMonthTable rows={[]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians={false} />);
    expect(screen.getByText(/No hay técnicos activos\./)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    rerender(<TechnicianMonthTable rows={[]} mes="2026-10" mesLabel="Octubre 2026" canManageTechnicians />);
    expect(screen.getByRole("link", { name: "Técnicos" })).toHaveAttribute("href", "/technicians");
  });

  it("links a técnico's closed count to the order list, filtered to that técnico and month", () => {
    render(<TechnicianMonthTable rows={[{ tecnicoId: "t1", nombre: "Luis Pérez", closed: 5, hours: 2 }]} mes="2026-11" mesLabel="Noviembre 2026" canManageTechnicians={false} />);

    const link = screen.getByRole("link", { name: "Ver las 5 órdenes cerradas de Luis Pérez en Noviembre 2026" });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/service-orders");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "done", tecnico: "t1", mes: "2026-11" });
  });

  it("leaves a zero count as plain text: there is nothing to open", () => {
    render(<TechnicianMonthTable rows={[row("Carla", 0, 0)]} mes="2026-11" mesLabel="Noviembre 2026" canManageTechnicians={false} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
