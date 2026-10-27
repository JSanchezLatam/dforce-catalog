import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DayView } from "./DayView";
import { makeItem } from "./items.fixture";

describe("DayView", () => {
  it("Chip fields: time, name, phone, plate in that order, linking to the order", () => {
    render(<DayView items={[makeItem()]} />);
    const chip = screen.getByRole("link", { name: /Pérez/ });
    expect(chip).toHaveAttribute("href", "/service-orders/o1");
    expect(chip.textContent).toMatch(/14:05.*Pérez.*61234567.*AB1234/);
    expect(chip.className).toContain("min-h-11");
  });

  it("Booked order without a vehicle shows 'Sin vehículo'", () => {
    render(<DayView items={[makeItem({ vehicleLabel: "Sin vehículo" })]} />);
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
  });

  it("Overlap stacks: three 09:00 chips all render, ordered by time then id", () => {
    const items = [
      makeItem({ id: "c", time: "09:00", customerName: "C" }),
      makeItem({ id: "a", time: "09:00", customerName: "A" }),
      makeItem({ id: "z", time: "08:00", customerName: "Z" }),
      makeItem({ id: "b", time: "09:00", customerName: "B" }),
    ];
    render(<DayView items={items} />);
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/service-orders/z",
      "/service-orders/a",
      "/service-orders/b",
      "/service-orders/c",
    ]);
  });

  it("Booked is actionable, later statuses are muted: an open chip is muted with its badge", () => {
    render(<DayView items={[makeItem({ status: "open", statusLabel: "Recibida", muted: true })]} />);
    expect(screen.getByText("Recibida")).toBeInTheDocument();
    expect(screen.getByRole("link").className).toContain("opacity-60");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a booked chip carries no status badge", () => {
    render(<DayView items={[makeItem()]} />);
    expect(screen.queryByText("Agendada")).not.toBeInTheDocument();
  });

  it("Vencida label: the text is there, not only a colour", () => {
    render(<DayView items={[makeItem({ overdue: true })]} />);
    expect(screen.getByText("Vencida")).toBeInTheDocument();
  });

  it("Empty day: explicit state", () => {
    render(<DayView items={[]} />);
    expect(screen.getByText("Sin citas para este día")).toBeInTheDocument();
  });
});
