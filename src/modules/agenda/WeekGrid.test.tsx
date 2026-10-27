import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ROW } from "./grid";
import { makeItem } from "./items.fixture";
import { WeekGrid } from "./WeekGrid";

const DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const TUE = DAYS[1];

const at = (id: string, dayKey: string, h: number, m = 0, over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ id, dayKey, customerName: `Cliente ${id}`, time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minuteOfDay: h * 60 + m, ...over });

const column = (container: HTMLElement, day: string) => container.querySelector(`[data-day-column="${day}"]`) as HTMLElement;
const header = (container: HTMLElement, day: string) => container.querySelector(`[data-day-header="${day}"]`) as HTMLElement;

describe("WeekGrid", () => {
  it("seven Monday-first columns headed by weekday, day number and the day's count", () => {
    const items = [at("a", DAYS[0], 9), at("b", DAYS[0], 10), at("c", TUE, 9)];
    const { container } = render(<WeekGrid days={DAYS} items={items} />);
    const heads = DAYS.map((d) => header(container, d));
    expect(heads.map((h) => h.querySelector("[data-weekday]")!.textContent)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(heads.map((h) => h.querySelector("[data-day-number]")!.textContent)).toEqual(["26", "27", "28", "29", "30", "31", "1"]);
    expect(heads.map((h) => h.querySelector("[data-day-count]")?.textContent ?? null)).toEqual(["2", "1", null, null, null, null, null]);
    expect(DAYS.map((d) => column(container, d))).toHaveLength(7);
  });

  it("each card lands in its own day's column", () => {
    const { container } = render(<WeekGrid days={DAYS} items={[at("a", DAYS[0], 9), at("c", TUE, 9)]} />);
    expect(within(column(container, DAYS[0])).getByRole("button", { name: /Cliente a/ })).toBeInTheDocument();
    expect(within(column(container, TUE)).getByRole("button", { name: /Cliente c/ })).toBeInTheDocument();
    expect(within(column(container, TUE)).queryByRole("button", { name: /Cliente a/ })).not.toBeInTheDocument();
  });

  it("Today and weekends are marked: 'Hoy' on today's header, the weekend mark on Saturday and Sunday only", () => {
    const { container } = render(<WeekGrid days={DAYS} items={[]} todayKey={TUE} />);
    expect(within(header(container, TUE)).getByText("Hoy")).toBeInTheDocument();
    expect(screen.getAllByText("Hoy")).toHaveLength(1);
    expect(DAYS.map((d) => column(container, d).hasAttribute("data-weekend"))).toEqual([false, false, false, false, false, true, true]);
    expect(DAYS.map((d) => column(container, d).classList.contains("agenda-hatch"))).toEqual([false, false, false, false, false, true, true]);
    expect(DAYS.map((d) => header(container, d).hasAttribute("data-weekend"))).toEqual([false, false, false, false, false, true, true]);
  });

  it("a week without today has no 'Hoy'", () => {
    render(<WeekGrid days={DAYS} items={[]} todayKey="2026-11-09" />);
    expect(screen.queryByText("Hoy")).not.toBeInTheDocument();
  });

  it("Now-line only on today: exactly one, labelled, inside today's column", () => {
    const { container } = render(<WeekGrid days={DAYS} items={[]} todayKey={TUE} nowMinute={10 * 60 + 40} />);
    const lines = container.querySelectorAll("[data-now-line]");
    expect(lines).toHaveLength(1);
    expect(column(container, TUE).contains(lines[0])).toBe(true);
    expect(lines[0]).toHaveTextContent("10:40");
    expect((lines[0] as HTMLElement).style.top).toBe(`${(160 / 60) * ROW}px`);
  });

  it("Now-line: none for a week without today, and none outside the grid hours", () => {
    const other = render(<WeekGrid days={DAYS} items={[]} todayKey="2026-11-09" nowMinute={10 * 60 + 40} />);
    expect(other.container.querySelector("[data-now-line]")).toBeNull();
    other.unmount();
    const late = render(<WeekGrid days={DAYS} items={[]} todayKey={TUE} nowMinute={19 * 60 + 30} />);
    expect(late.container.querySelector("[data-now-line]")).toBeNull();
  });

  it("lanes cap at 2: the third overlapping card becomes a 44px '+1' link to the day view", () => {
    const items = [at("a", TUE, 9), at("b", TUE, 9), at("c", TUE, 9)];
    const { container } = render(<WeekGrid days={DAYS} items={items} />);
    const col = column(container, TUE);
    const cards = within(col).getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    expect(cards.map((b) => within(b).getByText(/^Cliente/).textContent)).toEqual(["Cliente a", "Cliente b"]);
    expect(cards.map((b) => Number.parseFloat(b.parentElement!.style.width))).toEqual([50, 50]);
    const more = within(col).getByRole("link", { name: "+1 más" });
    expect(more).toHaveTextContent("+1");
    expect(more).toHaveAttribute("href", `/agenda?view=day&date=${TUE}`);
    expect(more).toHaveClass("min-h-11", "min-w-11");
  });

  it("two overlapping cards show no '+N' link; the count is the hidden ones", () => {
    const two = render(<WeekGrid days={DAYS} items={[at("a", TUE, 9), at("b", TUE, 9)]} />);
    expect(screen.queryByRole("link", { name: /más/ })).not.toBeInTheDocument();
    two.unmount();
    render(<WeekGrid days={DAYS} items={[at("a", TUE, 9), at("b", TUE, 9), at("c", TUE, 9), at("d", TUE, 9, 30)]} />);
    expect(screen.getByRole("link", { name: "+2 más" })).toBeInTheDocument();
  });

  it("Empty slot is a labelled control: each free hour of each day, only with onSlot", async () => {
    const onSlot = vi.fn();
    const { container, unmount } = render(<WeekGrid days={DAYS} items={[at("a", TUE, 9)]} onSlot={onSlot} />);
    expect(within(column(container, DAYS[0])).getAllByRole("button", { name: /^Nueva cita/ })).toHaveLength(10);
    const tue = within(column(container, TUE)).getAllByRole("button", { name: /^Nueva cita/ });
    expect(tue).toHaveLength(9);
    expect(tue.some((s) => s.getAttribute("aria-label") === "Nueva cita 27/10/2026 09:00")).toBe(false);
    await userEvent.click(within(column(container, DAYS[3])).getByRole("button", { name: "Nueva cita 29/10/2026 14:00" }));
    expect(onSlot).toHaveBeenCalledWith("2026-10-29", "14:00");
    unmount();
    render(<WeekGrid days={DAYS} items={[]} />);
    expect(screen.queryByRole("button", { name: /^Nueva cita/ })).not.toBeInTheDocument();
  });

  it("shares one hour window across the columns and labels the hours once", () => {
    render(<WeekGrid days={DAYS} items={[at("a", DAYS[0], 7, 15), at("b", DAYS[4], 18, 45)]} />);
    const labels = screen.getAllByText(/^\d\d:00$/).map((n) => n.textContent);
    expect(labels[0]).toBe("07:00");
    expect(labels.at(-1)).toBe("19:00");
    expect(labels).toHaveLength(13);
  });

  it("marks the selected card and reports a selection", async () => {
    const onSelect = vi.fn();
    render(<WeekGrid days={DAYS} items={[at("a", TUE, 9), at("b", DAYS[2], 9)]} selectedId="b" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Cliente b/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /Cliente a/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});
