import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DayGrid } from "./DayGrid";
import { ROW } from "./grid";
import { makeItem } from "./items.fixture";

const at = (id: string, h: number, m = 0, over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ id, customerName: `Cliente ${id}`, time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minuteOfDay: h * 60 + m, ...over });

const DAY = "2026-10-27";
const cardButtons = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));

describe("DayGrid", () => {
  it("Grid hours: rows 08:00 through 17:00, ending at 18:00", () => {
    render(<DayGrid date={DAY} items={[at("a", 8), at("b", 14, 30), at("c", 17)]} />);
    const labels = screen.getAllByText(/^\d\d:00$/).map((n) => n.textContent);
    expect(labels).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
  });

  it("Grid hours: a 14:30 block starts half a row below the 14:00 line", () => {
    render(<DayGrid date={DAY} items={[at("a", 14), at("b", 14, 30)]} />);
    const topOf = (name: RegExp) => Number.parseFloat(screen.getByRole("button", { name }).parentElement!.style.top);
    expect(topOf(/Cliente b/) - topOf(/Cliente a/)).toBe(ROW / 2);
    expect(topOf(/Cliente a/)).toBe(6 * ROW);
  });

  it("Outside the window: 07:15 and 18:45 are rendered and the labels extend to 07:00 and 19:00", () => {
    render(<DayGrid date={DAY} items={[at("a", 7, 15), at("b", 18, 45)]} />);
    expect(cardButtons()).toHaveLength(2);
    const labels = screen.getAllByText(/^\d\d:00$/).map((n) => n.textContent);
    expect(labels[0]).toBe("07:00");
    expect(labels.at(-1)).toBe("19:00");
  });

  it("Overlap is deterministic: three 09:00 cards all render in id order, in equal lanes", () => {
    render(<DayGrid date={DAY} items={[at("c", 9), at("a", 9), at("b", 9)]} />);
    const cards = cardButtons();
    expect(cards.map((b) => within(b).getByText(/^Cliente/).textContent)).toEqual(["Cliente a", "Cliente b", "Cliente c"]);
    const pct = (v: string) => Number.parseFloat(v);
    expect(cards.map((b) => pct(b.parentElement!.style.left))).toEqual([0, expect.closeTo(100 / 3), expect.closeTo(200 / 3)]);
    expect(cards.map((b) => pct(b.parentElement!.style.width))).toEqual([expect.closeTo(100 / 3), expect.closeTo(100 / 3), expect.closeTo(100 / 3)]);
  });

  it("Empty day: the text, and the grid is still there", () => {
    render(<DayGrid date={DAY} items={[]} />);
    expect(screen.getByText("Sin citas para este día")).toBeInTheDocument();
    expect(screen.getAllByText(/^\d\d:00$/)).toHaveLength(10);
  });

  it("a day with cards does not show the empty text", () => {
    render(<DayGrid date={DAY} items={[at("a", 9)]} />);
    expect(screen.queryByText("Sin citas para este día")).not.toBeInTheDocument();
  });

  it("Now-line only on today: labelled HH:mm at the current time", () => {
    const { container } = render(<DayGrid date={DAY} items={[]} todayKey={DAY} nowMinute={10 * 60 + 40} />);
    const line = container.querySelector("[data-now-line]") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line).toHaveTextContent("10:40");
    expect(line.style.top).toBe(`${(160 / 60) * ROW}px`);
  });

  it("Now-line: none on another day, none outside the grid, none without a clock", () => {
    const none = (props: Partial<React.ComponentProps<typeof DayGrid>>) => {
      const { container, unmount } = render(<DayGrid date={DAY} items={[]} {...props} />);
      const found = container.querySelector("[data-now-line]");
      unmount();
      return found;
    };
    expect(none({ todayKey: "2026-10-28", nowMinute: 10 * 60 + 40 })).toBeNull();
    expect(none({ todayKey: DAY, nowMinute: 19 * 60 + 30 })).toBeNull();
    expect(none({})).toBeNull();
  });

  it("Empty slot is a labelled control: each free hour is a button named with day and hour", async () => {
    const onSlot = vi.fn();
    render(<DayGrid date={DAY} items={[at("a", 9), at("b", 14, 30)]} onSlot={onSlot} />);
    const slots = screen.getAllByRole("button", { name: /^Nueva cita/ });
    expect(slots.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Nueva cita 27/10/2026 08:00",
      "Nueva cita 27/10/2026 10:00",
      "Nueva cita 27/10/2026 11:00",
      "Nueva cita 27/10/2026 12:00",
      "Nueva cita 27/10/2026 13:00",
      "Nueva cita 27/10/2026 15:00",
      "Nueva cita 27/10/2026 16:00",
      "Nueva cita 27/10/2026 17:00",
    ]);
    await userEvent.click(slots[1]);
    expect(onSlot).toHaveBeenCalledWith(DAY, "10:00");
  });

  it("without onSlot no slot control renders", () => {
    render(<DayGrid date={DAY} items={[at("a", 9)]} />);
    expect(screen.queryByRole("button", { name: /^Nueva cita/ })).not.toBeInTheDocument();
  });

  it("marks the selected card and reports a selection", async () => {
    const onSelect = vi.fn();
    render(<DayGrid date={DAY} items={[at("a", 9), at("b", 11)]} selectedId="b" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Cliente b/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cliente a/ })).toHaveAttribute("aria-pressed", "false");
    const card = screen.getByRole("button", { name: /Cliente a/ });
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), card);
  });
});
