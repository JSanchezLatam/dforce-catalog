// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PortalOrder, PortalVehicle } from "../../src/contract";
import { History } from "./History";

afterEach(cleanup);

const order = (over: Partial<PortalOrder> = {}): PortalOrder => ({
  id: "ord-1",
  status: "En proceso",
  categoria: "Instalación de audio",
  createdAt: "2026-09-01T15:00:00.000Z",
  appointmentAt: null,
  completedAt: null,
  description: null,
  hallazgos: null,
  recomendaciones: null,
  ...over,
});
const vehicle = (over: Partial<PortalVehicle> = {}): PortalVehicle => ({
  id: "v1",
  plate: "AB1234",
  make: "Toyota",
  model: "Corolla",
  year: 2015,
  orders: [order()],
  ...over,
});
const snap = (vehicles: PortalVehicle[], generatedAt = "2026-10-01T15:30:00.000Z") => ({ vehicles, generatedAt });

describe("History", () => {
  it("groups orders under their vehicle: plate, make, model, year", () => {
    render(<History snapshot={snap([vehicle(), vehicle({ id: "v2", plate: "ZZ9999", make: null, model: null, year: null, orders: [order({ id: "ord-2" })] })])} />);
    const first = screen.getByRole("region", { name: "AB1234" });
    expect(within(first).getByText("Toyota Corolla · 2015")).toBeTruthy();
    expect(within(first).getByText("N.º ord-1")).toBeTruthy();
    expect(within(first).queryByText("N.º ord-2")).toBeNull();
    const second = screen.getByRole("region", { name: "ZZ9999" });
    expect(within(second).getByText("N.º ord-2")).toBeTruthy();
  });

  it("lists orders newest first whatever the wire order", () => {
    const orders = [
      order({ id: "old", createdAt: "2026-01-01T10:00:00.000Z" }),
      order({ id: "new", createdAt: "2026-09-01T10:00:00.000Z" }),
      order({ id: "mid", createdAt: "2026-05-01T10:00:00.000Z" }),
    ];
    render(<History snapshot={snap([vehicle({ orders })])} />);
    const ids = screen.getAllByText(/^N\.º /).map((n) => n.textContent);
    expect(ids).toEqual(["N.º new", "N.º mid", "N.º old"]);
  });

  it("renders the status label exactly as received, with its category", () => {
    render(<History snapshot={snap([vehicle({ orders: [order({ status: "Terminada" })] })])} />);
    expect(screen.getByText("Terminada")).toBeTruthy();
    expect(screen.getByText("Instalación de audio")).toBeTruthy();
  });

  it("shows created always and appointment/completed only when set, in es-PA", () => {
    const { rerender } = render(<History snapshot={snap([vehicle()])} />);
    expect(screen.getByText("Ingreso")).toBeTruthy();
    expect(screen.getByText("1 de septiembre de 2026")).toBeTruthy();
    expect(screen.queryByText("Cita")).toBeNull();
    expect(screen.queryByText("Finalización")).toBeNull();

    rerender(
      <History
        snapshot={snap([vehicle({ orders: [order({ appointmentAt: "2026-09-05T15:00:00.000Z", completedAt: "2026-09-07T20:00:00.000Z" })] })])}
      />,
    );
    expect(screen.getByText("Cita")).toBeTruthy();
    expect(screen.getByText(/^5 de septiembre de 2026, 10:00/)).toBeTruthy();
    expect(screen.getByText("Finalización")).toBeTruthy();
    expect(screen.getByText("7 de septiembre de 2026")).toBeTruthy();
  });

  it("shows description, hallazgos and recomendaciones only when set", () => {
    const { rerender } = render(<History snapshot={snap([vehicle()])} />);
    for (const label of ["Descripción", "Hallazgos", "Recomendaciones"]) expect(screen.queryByText(label)).toBeNull();

    rerender(<History snapshot={snap([vehicle({ orders: [order({ hallazgos: "Cableado quemado", recomendaciones: null, description: "" })] })])} />);
    expect(screen.getByText("Hallazgos")).toBeTruthy();
    expect(screen.getByText("Cableado quemado")).toBeTruthy();
    expect(screen.queryByText("Recomendaciones")).toBeNull();
    expect(screen.queryByText("Descripción")).toBeNull();
  });

  it("shows when the data was last updated", () => {
    render(<History snapshot={snap([vehicle()])} />);
    expect(screen.getByText(/^Actualizado: 1 de octubre de 2026, 10:30/)).toBeTruthy();
  });

  it("says so when there is nothing to show", () => {
    const { rerender } = render(<History snapshot={snap([])} />);
    expect(screen.getByText("Todavía no hay órdenes de servicio para mostrar.")).toBeTruthy();
    rerender(<History snapshot={snap([vehicle({ orders: [] })])} />);
    expect(screen.getByText("Sin órdenes todavía.")).toBeTruthy();
  });

  it("wraps long text instead of overflowing a 360px screen", () => {
    const { container } = render(<History snapshot={snap([vehicle({ orders: [order({ hallazgos: "x".repeat(300) })] })])} />);
    // jsdom has no layout: the contract is the class that carries `overflow-wrap`.
    const texts = [...container.querySelectorAll("dd.wrap")].map((n) => n.textContent);
    expect(texts).toContain("x".repeat(300));
  });
});
