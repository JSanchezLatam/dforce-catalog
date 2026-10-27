import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeItem } from "./items.fixture";
import { VencidasPanel } from "./VencidasPanel";

const late = (over = {}) => makeItem({ overdue: true, dayKey: "2026-09-16", time: "08:30", ...over });

describe("VencidasPanel", () => {
  it("Count is the true count: the heading shows total, not the rows shown", () => {
    render(<VencidasPanel items={[late({ id: "a" }), late({ id: "b" })]} total={3} truncated={false} />);
    expect(screen.getByRole("heading", { name: "Vencidas (3)" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("each row: chip fields, the full Panama date as digits, the Vencida label, a link to the order", () => {
    render(<VencidasPanel items={[late({ id: "a" })]} total={1} truncated={false} />);
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("16/09/2026 08:30");
    expect(row.textContent).toMatch(/Pérez.*61234567.*AB1234/);
    expect(within(row).getByText("Vencida")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Pérez/ })).toHaveAttribute("href", "/service-orders/a");
  });

  it("keeps the order it is given (the query sends oldest first)", () => {
    render(<VencidasPanel items={[late({ id: "old", customerName: "Vieja", dayKey: "2026-08-01" }), late({ id: "new", customerName: "Nueva" })]} total={2} truncated={false} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Vieja"), expect.stringContaining("Nueva")]);
  });

  it("N = 0: the count stays in the heading and the empty state shows", () => {
    render(<VencidasPanel items={[]} total={0} truncated={false} />);
    expect(screen.getByRole("heading", { name: "Vencidas (0)" })).toBeInTheDocument();
    expect(screen.getByText("Sin citas vencidas")).toBeInTheDocument();
  });

  it("discloses a capped list", () => {
    const { rerender } = render(<VencidasPanel items={[late()]} total={900} truncated={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<VencidasPanel items={[late()]} total={900} truncated />);
    expect(screen.getByRole("status")).toHaveTextContent("Se muestran las primeras 500 citas vencidas.");
  });

  it("offers a named slot for the row actions (WU8) and renders nothing there until it is given", () => {
    const { rerender } = render(<VencidasPanel items={[late({ id: "a" })]} total={1} truncated={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<VencidasPanel items={[late({ id: "a" })]} total={1} truncated={false} actions={(i) => <button>Acción {i.id}</button>} />);
    expect(screen.getByRole("button", { name: "Acción a" })).toBeInTheDocument();
  });
});
