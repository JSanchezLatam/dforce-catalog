import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DayStrip } from "./DayStrip";

// Wednesday 2026-10-28 is selected; the week is Mon 26 - Sun 1 Nov.
const base = { view: "week" as const, date: "2026-10-28", today: "2026-10-27", busyDays: ["2026-10-27", "2026-10-29"] };
const days = () => within(screen.getByRole("navigation", { name: "Días de la semana" })).getAllByRole("link");

describe("DayStrip", () => {
  it("Phone day strip: seven Monday-first links, each rewriting date and keeping the view", () => {
    render(<DayStrip {...base} />);
    expect(days().map((l) => l.getAttribute("href"))).toEqual(
      ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => `/agenda?view=week&date=${d}`),
    );
    expect(days().map((l) => l.textContent?.replace(/\s*con citas$/, ""))).toEqual(["Lun26", "Mar27", "Mié28", "Jue29", "Vie30", "Sáb31", "Dom1"]);
  });

  it("Phone day strip: a dot with accessible text only on the days with appointments", () => {
    render(<DayStrip {...base} />);
    expect(days().filter((l) => l.querySelector("[data-busy-dot]")).map((l) => l.getAttribute("href")?.slice(-10))).toEqual(["2026-10-27", "2026-10-29"]);
    expect(within(days()[1]).getByText("con citas", { exact: false }).className).toContain("sr-only");
    expect(days()[0]).not.toHaveTextContent("con citas");
  });

  it("Today is marked and the selected day is highlighted, separately", () => {
    render(<DayStrip {...base} />);
    expect(days().filter((l) => l.getAttribute("aria-current") === "date").map((l) => l.textContent)).toEqual([expect.stringContaining("Mar")]);
    expect(days().filter((l) => l.hasAttribute("data-selected")).map((l) => l.textContent)).toEqual([expect.stringContaining("Mié")]);
  });

  it("Hit targets classes: each day is at least 44x44", () => {
    render(<DayStrip {...base} />);
    for (const l of days()) {
      expect(l.className).toMatch(/(^|\s)min-h-11(\s|$)/);
      expect(l.className).toMatch(/(^|\s)min-w-11(\s|$)/);
    }
  });

  it("The strip scrolls inside itself, is phone-only, and the days do not shrink below their size", () => {
    render(<DayStrip {...base} />);
    const strip = screen.getByRole("navigation", { name: "Días de la semana" });
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("md:hidden");
    for (const l of days()) expect(l.className).toContain("shrink-0");
  });
});
