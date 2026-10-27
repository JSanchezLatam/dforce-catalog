import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { KanbanCard as Card } from "./shape";
import { KanbanCardView } from "./KanbanCard";

const GENERATED_AT = "2026-10-26T15:00:00.000Z";
// A wire-shaped card (kanban/shape.ts); a test overrides only what it is about.
const card = (over: Partial<Card> = {}): Card => ({
  id: "ord-1",
  status: "in_progress",
  statusLabel: "En progreso",
  plate: "AB1234",
  make: "Toyota",
  model: "Hilux",
  holdReason: null,
  technicians: ["Ana", "Beto"],
  statusSince: "2026-10-26T14:48:00.000Z",
  urgent: false,
  categoria: "instalacion",
  missing: [],
  mine: false,
  ...over,
});
const renderCard = (over?: Partial<Card>) => render(<ul><KanbanCardView card={card(over)} generatedAt={GENERATED_AT} /></ul>);

describe("KanbanCardView", () => {
  it("shows plate, vehicle, full technician names and a neutral time chip, and no amber strip for a plain in-progress card", () => {
    renderCard();
    expect(screen.getByText("AB1234")).toBeInTheDocument();
    expect(screen.getByText("Toyota Hilux")).toBeInTheDocument();
    expect(screen.getByText("Ana, Beto")).toHaveClass("sr-only");
    expect(screen.getByText("hace 12 min")).toBeInTheDocument();
    expect(document.querySelector(".bg-board-warn-bg")).toBeNull();
  });

  it("a booked card shows the appointment time in Panama and the overdue strip", () => {
    renderCard({ status: "booked", appointmentAt: "2026-10-26T14:00:00.000Z" });
    expect(screen.getByText("26/10 09:00")).toBeInTheDocument();
    expect(screen.getByText("Cita vencida · hace 1 h")).toBeInTheDocument();
  });

  it("a booked card with no vehicle and no category reads Sin placa, Sin vehículo and the missing strip", () => {
    renderCard({ status: "booked", plate: "Sin vehículo", make: null, model: null, categoria: null, missing: ["vehiculo", "categoria"], appointmentAt: null, technicians: [] });
    expect(screen.getByText("Sin placa")).toBeInTheDocument();
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
    expect(screen.getByText("Falta vehículo y categoría")).toBeInTheDocument();
    expect(screen.getByText("Sin técnico")).toBeInTheDocument();
  });

  it("the ⋯ button is 44x44 and its menu offers only Ver orden, linking to the order", async () => {
    renderCard();
    const button = screen.getByRole("button", { name: "Acciones de la orden" });
    expect(button).toHaveClass("size-11");
    await userEvent.click(button);
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Ver orden"]);
    expect(screen.getByRole("menuitem", { name: "Ver orden" })).toHaveAttribute("href", "/service-orders/ord-1");
  });
});
