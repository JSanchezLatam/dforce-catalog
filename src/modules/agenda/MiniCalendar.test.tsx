import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MiniCalendar } from "./MiniCalendar";

const base = { view: "week" as const, date: "2026-10-27", today: "2026-10-27", busyDays: ["2026-10-02", "2026-10-05"] };
const day = (n: number) => document.querySelector(`[data-day="2026-10-${String(n).padStart(2, "0")}"]`) as HTMLElement;

describe("MiniCalendar", () => {
  it("Monday-first month grid with the month name and year from static text", () => {
    render(<MiniCalendar {...base} />);
    expect(screen.getByText("Octubre 2026")).toBeInTheDocument();
    expect([...document.querySelectorAll("[data-weekday]")].map((h) => h.textContent)).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
    expect(document.querySelectorAll("[data-day]")).toHaveLength(35);
    expect(document.querySelector("[data-day]")).toHaveAttribute("data-day", "2026-09-28");
  });

  it("Mini calendar busy dots: only the two busy days carry the dot and its accessible text", () => {
    render(<MiniCalendar {...base} />);
    expect(screen.getAllByText("con citas")).toHaveLength(2);
    expect(within(day(2)).getByText("con citas")).toBeInTheDocument();
    expect(within(day(5)).getByText("con citas")).toBeInTheDocument();
    expect(within(day(3)).queryByText("con citas")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-busy-dot]")).toHaveLength(2);
  });

  it("Mini calendar navigation: cells are links keeping the view, and the month controls move to the 1st of the adjacent month", () => {
    render(<MiniCalendar {...base} />);
    expect(day(14)).toHaveAttribute("href", "/agenda?view=week&date=2026-10-14");
    expect(screen.getByRole("link", { name: "Mes siguiente" })).toHaveAttribute("href", "/agenda?view=week&date=2026-11-01");
    expect(screen.getByRole("link", { name: "Mes anterior" })).toHaveAttribute("href", "/agenda?view=week&date=2026-09-01");
  });

  it("the month view keeps view=month in every link", () => {
    render(<MiniCalendar {...base} view="month" />);
    expect(day(14)).toHaveAttribute("href", "/agenda?view=month&date=2026-10-14");
  });

  it("the selected week (Mon 26 - Sun 1) is highlighted, and nothing else", () => {
    render(<MiniCalendar {...base} />);
    const marked = [...document.querySelectorAll("[data-selected-week]")].map((e) => e.getAttribute("data-day"));
    expect(marked).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("today is marked and no other day is", () => {
    render(<MiniCalendar {...base} today="2026-10-29" />);
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(day(29)).toHaveAttribute("aria-current", "date");
  });

  it("days of the neighbouring months are dimmed and carry no busy dot", () => {
    render(<MiniCalendar {...base} busyDays={["2026-10-02", "2026-11-01"]} />);
    expect(document.querySelector('[data-day="2026-11-01"]')).toHaveAttribute("data-outside");
    expect(day(2)).not.toHaveAttribute("data-outside");
    expect(document.querySelector('[data-day="2026-11-01"]')!.className).toContain("opacity-50");
    expect(day(2).className).not.toContain("opacity-50");
    expect(screen.getAllByText("con citas")).toHaveLength(1);
  });

  it("Hit targets classes: every cell and month control is at least 44x44", () => {
    const { container } = render(<MiniCalendar {...base} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-11");
    }
    // 7 x 44 = 308px of cells must fit inside the card: p-3 plus the 1px border leaves 310px of a 21rem column.
    expect(container.firstElementChild!.className).toContain("p-3");
  });
});
