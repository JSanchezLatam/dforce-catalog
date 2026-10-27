import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeItem } from "./items.fixture";
import { MonthView } from "./MonthView";

const DAY = "2026-10-15";
const at = (n: number, dayKey = DAY) =>
  Array.from({ length: n }, (_, i) => makeItem({ id: `i${i}`, dayKey, time: `0${i + 1}:00`, customerName: `Cliente ${i + 1}` }));
const cell = (key: string) => screen.getByTestId(`cell-${key}`);

describe("MonthView", () => {
  it("draws Monday-first week rows: Oct 2026 spans 19 Sep to 1 Nov (5 rows), Feb 2027 only 4", () => {
    const { rerender } = render(<MonthView date="2026-10-10" today="2026-10-15" items={[]} />);
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(35);
    expect(cell("2026-09-28")).toBeInTheDocument();
    expect(cell("2026-11-01")).toBeInTheDocument();
    rerender(<MonthView date="2027-02-10" today="2026-10-15" items={[]} />);
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(28);
  });

  it("Month cell cap: 5 appointments show the first 3 by time and '+2 más' to the day view", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(5).reverse()} />);
    const c = within(cell(DAY));
    expect(c.getAllByText(/^Cliente \d$/).map((e) => e.textContent)).toEqual(["Cliente 1", "Cliente 2", "Cliente 3"]);
    expect(c.getByRole("link", { name: "+2 más" })).toHaveAttribute("href", `/agenda?view=day&date=${DAY}`);
  });

  it("Exactly three chips show no overflow link", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(3)} />);
    expect(within(cell(DAY)).getAllByText(/^Cliente \d$/)).toHaveLength(3);
    expect(screen.queryByText(/más$/)).not.toBeInTheDocument();
  });

  it("Singular and plural are not special-cased: 4 appointments read '+1 más'", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(4)} />);
    expect(screen.getByRole("link", { name: "+1 más" })).toBeInTheDocument();
  });

  it("Outside-month days are dimmed but still carry their chips", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(1, "2026-09-30")} />);
    expect(cell("2026-09-30").className).toContain("opacity-50");
    expect(within(cell("2026-09-30")).getByText("Cliente 1")).toBeInTheDocument();
    expect(cell(DAY).className).not.toContain("opacity-50");
  });

  it("marks today's Panama day", () => {
    render(<MonthView date={DAY} today="2026-10-20" items={[]} />);
    expect(cell("2026-10-20").querySelector("[aria-current='date']")).not.toBeNull();
    expect(cell("2026-10-21").querySelector("[aria-current='date']")).toBeNull();
  });

  it("Hit targets classes: day numbers and '+N más' links are at least 44x44", () => {
    render(<MonthView date={DAY} today="2026-10-20" items={at(5)} />);
    const links = [...within(cell(DAY)).getAllByRole("link")].filter((l) => /^(\d+|\+\d+ más)$/.test(l.textContent ?? ""));
    expect(links).toHaveLength(2);
    for (const l of links) {
      expect(l.className).toContain("min-h-11");
      expect(l.className).toContain("min-w-11");
    }
  });

  it("phone: chips collapse to a count below md and show in full from md", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(2)} />);
    expect(within(cell(DAY)).getByLabelText("2 citas").className).toContain("md:hidden");
    expect(within(cell(DAY)).getByRole("list").className).toContain("max-md:hidden");
  });
});
