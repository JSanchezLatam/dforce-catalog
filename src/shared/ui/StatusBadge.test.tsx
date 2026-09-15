import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

/**
 * H2 — `StatusBadge` is 20px tall (`text-xs` line box + `py-0.5`), matching the
 * shadcn `Badge`'s `h-5`. Six of its seven render sites are a table cell or an
 * inline chip in a heading, where 20px is right and where growing it would add
 * height to every row. The seventh — `ManualSyncButton` — sits beside an `h-8`
 * Button, which is where the mismatch was reported.
 *
 * So the size stays, and the one row that needs a taller chip asks for it. This
 * `className` passthrough is what lets it, without the other six changing.
 *
 * jsdom measures nothing (`getBoundingClientRect` is all zeros here), so this
 * asserts the class is applied and composed — never the rendered height.
 */
describe("StatusBadge — className passthrough (H2)", () => {
  it("applies a caller's class on top of the status classes", () => {
    render(<StatusBadge status="completed" label="Completada" className="min-h-7 px-3" />);
    const badge = screen.getByText("Completada");

    expect(badge).toHaveClass("min-h-7");
    expect(badge).toHaveClass("px-3");
  });

  it("keeps the status colours when a caller passes a class", () => {
    render(<StatusBadge status="completed" label="Completada" className="min-h-7" />);
    const badge = screen.getByText("Completada");

    expect(badge).toHaveClass("bg-success");
    expect(badge).toHaveClass("text-success-foreground");
  });

  it("renders unchanged when no class is passed, so the other six sites do not move", () => {
    render(<StatusBadge status="done" label="Finalizada" />);
    const badge = screen.getByText("Finalizada");

    expect(badge).toHaveClass("py-0.5");
    expect(badge.className).not.toContain("min-h-");
  });
});
