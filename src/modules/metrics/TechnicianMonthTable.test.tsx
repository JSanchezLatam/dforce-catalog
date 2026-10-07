import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TechnicianMonthTable } from "./TechnicianMonthTable";

const row = (nombre: string, closed: number, hours: number) => ({ tecnicoId: nombre, nombre, closed, hours });

describe("TechnicianMonthTable", () => {
  it("has the three columns and shows closed orders and hours with one decimal", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 3, 4.5)]} mesLabel="Octubre 2026" canManageTechnicians={false} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Técnico", "Órdenes cerradas", "Horas"]);
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["Luis", "3", "4.5 h"]);
  });

  it("rounds hours to one decimal", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 1, 1.25)]} mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("1.3 h")).toBeInTheDocument();
  });

  it("sorts by closed orders, then hours, both descending", () => {
    render(
      <TechnicianMonthTable
        rows={[row("Ana", 1, 9), row("Beto", 3, 1), row("Carla", 3, 2)]}
        mesLabel="Octubre 2026"
        canManageTechnicians={false}
      />,
    );

    const names = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Carla", "Beto", "Ana"]);
  });

  it("says a shared order counts for every assignee", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 3, 4.5)]} mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("Una orden con varios técnicos cuenta para cada uno.")).toBeInTheDocument();
  });

  it("teaches what counts when the month has no closed orders, and still lists the roster", () => {
    render(<TechnicianMonthTable rows={[row("Luis", 0, 0)]} mesLabel="Octubre 2026" canManageTechnicians={false} />);

    expect(screen.getByText("Todavía no hay órdenes cerradas en Octubre 2026. Una orden cuenta cuando pasa a Completada.")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("explains an empty roster and links to Técnicos only for who can manage them", () => {
    const { rerender } = render(<TechnicianMonthTable rows={[]} mesLabel="Octubre 2026" canManageTechnicians={false} />);
    expect(screen.getByText(/No hay técnicos activos\./)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    rerender(<TechnicianMonthTable rows={[]} mesLabel="Octubre 2026" canManageTechnicians />);
    expect(screen.getByRole("link", { name: "Técnicos" })).toHaveAttribute("href", "/technicians");
  });
});
