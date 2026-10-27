import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeItem } from "./items.fixture";
import { WeekView } from "./WeekView";

describe("WeekView", () => {
  it("renders seven Monday-first day columns from a Sunday date, as links to the day view", () => {
    render(<WeekView date="2026-10-25" today="2026-10-28" items={[]} />);
    const heads = screen.getAllByRole("link");
    expect(heads.map((h) => h.getAttribute("href"))).toEqual(
      ["19", "20", "21", "22", "23", "24", "25"].map((d) => `/agenda?view=day&date=2026-10-${d}`),
    );
    expect(heads[0].textContent).toBe("Lun 19");
    expect(heads[6].textContent).toBe("Dom 25");
  });

  it("collapses to a vertical list on phone and seven columns from md", () => {
    const { container } = render(<WeekView date="2026-10-26" today="2026-10-28" items={[]} />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-7");
  });

  it("puts each chip under its own day, ordered, with Vencida visible", () => {
    const items = [
      makeItem({ id: "b", dayKey: "2026-10-27", time: "10:00", customerName: "Beta", overdue: true }),
      makeItem({ id: "a", dayKey: "2026-10-26", time: "09:00", customerName: "Alfa" }),
    ];
    render(<WeekView date="2026-10-26" today="2026-10-28" items={items} />);
    const tuesday = screen.getByTestId("day-2026-10-27");
    expect(within(tuesday).getByText("Beta")).toBeInTheDocument();
    expect(within(tuesday).getByText("Vencida")).toBeInTheDocument();
    expect(within(screen.getByTestId("day-2026-10-26")).getByText("Alfa")).toBeInTheDocument();
    expect(within(tuesday).queryByText("Alfa")).not.toBeInTheDocument();
  });

  it("marks today's Panama day", () => {
    render(<WeekView date="2026-10-26" today="2026-10-28" items={[]} />);
    expect(screen.getByTestId("day-2026-10-28").querySelector("[aria-current='date']")).not.toBeNull();
    expect(screen.getByTestId("day-2026-10-27").querySelector("[aria-current='date']")).toBeNull();
  });

  it("Hit targets classes: day headers are at least 44x44", () => {
    render(<WeekView date="2026-10-26" today="2026-10-28" items={[]} />);
    for (const head of screen.getAllByRole("link")) {
      expect(head.className).toContain("min-h-11");
      expect(head.className).toContain("min-w-11");
    }
  });
});
