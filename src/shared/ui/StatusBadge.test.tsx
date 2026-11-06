import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ORDER_HUE } from "./status-hue";
import { StatusBadge, type BadgeStatus } from "./StatusBadge";

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

    expect(badge).toHaveClass("bg-green-100", "text-green-800");
    expect(badge).toHaveClass("dark:bg-green-400/15", "dark:text-green-300");
  });

  it("renders unchanged when no class is passed, so the other six sites do not move", () => {
    render(<StatusBadge status="completed" label="Finalizada" />);
    const badge = screen.getByText("Finalizada");

    expect(badge).toHaveClass("py-0.5");
    expect(badge.className).not.toContain("min-h-");
  });
});

describe("StatusBadge — the eight order statuses", () => {
  const ORDER_STATUSES: BadgeStatus[] = [
    "booked",
    "open",
    "diagnosing",
    "in_progress",
    "on_hold",
    "ready_for_review",
    "done",
    "cancelled",
  ];

  /** A chip's look is its tone classes plus its icon; two statuses sharing both read as one. */
  const lookOf = (status: BadgeStatus): string => {
    const { container, unmount } = render(<StatusBadge status={status} label={status} />);
    const chip = container.firstElementChild as HTMLElement;
    const look = `${chip.className}|${chip.getAttribute("style")}|${chip.querySelector("svg")?.getAttribute("class")}`;
    unmount();
    return look;
  };

  it("gives all eight order statuses a distinct look", () => {
    const looks = ORDER_STATUSES.map(lookOf);
    expect(new Set(looks).size).toBe(8);
  });

  it("does not render booked like the reminder state scheduled", () => {
    expect(lookOf("booked")).not.toBe(lookOf("scheduled"));
  });
});

describe("StatusBadge: order statuses wear their board hue", () => {
  it.each(Object.entries(ORDER_HUE))("%s renders hue-tint with --h/--s from ORDER_HUE", (status, { h, s }) => {
    render(<StatusBadge status={status as BadgeStatus} label="x" />);
    const badge = screen.getByText("x");

    expect(badge).toHaveClass("hue-tint");
    expect(badge.style.getPropertyValue("--h")).toBe(String(h));
    expect(badge.style.getPropertyValue("--s")).toBe(s);
    expect(badge.className).not.toMatch(/\bbg-(zinc|amber|green|sky|red)-/);
  });

  it("keeps cancelled neutral and struck through, with no hue", () => {
    render(<StatusBadge status="cancelled" label="x" />);
    const badge = screen.getByText("x");

    expect(badge).toHaveClass("line-through", "bg-zinc-100");
    expect(badge).not.toHaveClass("hue-tint");
    expect(badge.style.getPropertyValue("--h")).toBe("");
  });

  it("gives En progreso and En espera different hues (they were both amber)", () => {
    render(
      <>
        <StatusBadge status="in_progress" label="progreso" />
        <StatusBadge status="on_hold" label="espera" />
      </>,
    );

    expect(screen.getByText("progreso").style.getPropertyValue("--h")).not.toBe(screen.getByText("espera").style.getPropertyValue("--h"));
  });

  it("leaves the non-order uses on their tone classes", () => {
    render(<StatusBadge status="warning" label="w" />);
    const badge = screen.getByText("w");

    expect(badge).toHaveClass("bg-amber-100", "text-amber-800");
    expect(badge).not.toHaveClass("hue-tint");
    expect(badge.getAttribute("style")).toBeNull();
  });
});
