import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeItem } from "./items.fixture";
import { MonthView } from "./MonthView";

const DAY = "2026-10-15";
// "Sin vehículo" so a card reads "HH:mm Cliente n" (the customer's first name stands in for the plate).
const at = (n: number, dayKey = DAY) =>
  Array.from({ length: n }, (_, i) => makeItem({ id: `i${i}`, dayKey, time: `0${i + 1}:00`, customerName: `Cliente ${i + 1}`, vehicleLabel: "Sin vehículo" }));
const cell = (key: string) => screen.getByTestId(`cell-${key}`);
const cards = (key: string) => within(cell(key)).queryAllByRole("button", { name: /^\d\d:\d\d / });

describe("MonthView", () => {
  it("draws Monday-first week rows: Oct 2026 spans 28 Sep to 1 Nov (5 rows), Feb 2027 only 4", () => {
    const { rerender } = render(<MonthView date="2026-10-10" today="2026-10-15" items={[]} />);
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(35);
    expect(cell("2026-09-28")).toBeInTheDocument();
    expect(cell("2026-11-01")).toBeInTheDocument();
    rerender(<MonthView date="2027-02-10" today="2026-10-15" items={[]} />);
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(28);
  });

  it("Month cell cap: 5 appointments show the first 3 by time and '+2 más' to the day view", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(5).reverse()} />);
    expect(cards(DAY).map((c) => c.textContent)).toEqual(["01:00 Cliente", "02:00 Cliente", "03:00 Cliente"]);
    expect(within(cell(DAY)).getByRole("link", { name: "+2 más" })).toHaveAttribute("href", `/agenda?view=day&date=${DAY}`);
  });

  it("Exactly three cards show no overflow link", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(3)} />);
    expect(cards(DAY)).toHaveLength(3);
    expect(screen.queryByText(/más$/)).not.toBeInTheDocument();
  });

  it("Singular and plural are not special-cased: 4 appointments read '+1 más'", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(4)} />);
    expect(screen.getByRole("link", { name: "+1 más" })).toBeInTheDocument();
  });

  it("Month card: HH:mm plus the plate, or the customer's first name with no vehicle; it opens the Detail from its own element", async () => {
    const onSelect = vi.fn();
    const a = makeItem({ id: "a", dayKey: DAY, time: "09:00", vehicleLabel: "AB1234 · Toyota Corolla" });
    const b = makeItem({ id: "b", dayKey: DAY, time: "10:00", customerName: "Ana Pérez", vehicleLabel: "Sin vehículo" });
    render(<MonthView date={DAY} today="2026-01-01" items={[a, b]} onSelect={onSelect} />);
    const [first, second] = cards(DAY);
    expect(first.textContent).toBe("09:00 AB1234");
    expect(second).toHaveTextContent("10:00 Ana");
    expect(second).not.toHaveTextContent("Pérez");
    await userEvent.click(second);
    expect(onSelect).toHaveBeenCalledWith(b, second);
  });

  it("Month card carries status text: a glyph, and 'Vencida' / the no-show label in the accessible name", () => {
    const items = [
      makeItem({ id: "v", dayKey: DAY, time: "09:00", overdue: true }),
      makeItem({ id: "n", dayKey: DAY, time: "10:00", status: "cancelled", statusLabel: "No se presentó", noShow: true, muted: true }),
      makeItem({ id: "p", dayKey: DAY, time: "11:00" }),
    ];
    render(<MonthView date={DAY} today="2026-01-01" items={items} />);
    const [vencida, noShow, plain] = cards(DAY);
    expect(vencida).toHaveAccessibleName(/Vencida/);
    expect(noShow).toHaveAccessibleName(/No se presentó/);
    expect(plain).not.toHaveAccessibleName(/Vencida|No se presentó/);
    for (const c of [vencida, noShow, plain]) expect(c.querySelector("svg[aria-hidden]")).not.toBeNull();
  });

  it("Colour follows the type: the card carries the data-categoria hook ('none' for no type), and a selected card is aria-pressed", () => {
    const items = [makeItem({ id: "a", dayKey: DAY, time: "09:00", categoria: "instalacion" }), makeItem({ id: "b", dayKey: DAY, time: "10:00", categoria: null })];
    render(<MonthView date={DAY} today="2026-01-01" items={items} selectedId="b" />);
    const [a, b] = cards(DAY);
    expect(a).toHaveAttribute("data-categoria", "instalacion");
    expect(a.className).toContain("agenda-ev");
    expect(b).toHaveAttribute("data-categoria", "none");
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("aria-pressed", "true");
  });

  it("Outside-month days are dimmed but still carry their cards", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(1, "2026-09-30")} />);
    expect(cell("2026-09-30").className).toContain("opacity-50");
    expect(cards("2026-09-30")).toHaveLength(1);
    expect(cell(DAY).className).not.toContain("opacity-50");
  });

  it("marks today's Panama day", () => {
    render(<MonthView date={DAY} today="2026-10-20" items={[]} />);
    expect(cell("2026-10-20").querySelector("[aria-current='date']")).not.toBeNull();
    expect(cell("2026-10-21").querySelector("[aria-current='date']")).toBeNull();
  });

  it("Hit targets classes: cells, day numbers, cards, '+N más' and the cell '+' are at least 44x44", () => {
    render(<MonthView date={DAY} today="2026-10-20" items={at(5)} onSlot={() => {}} />);
    const own = [cell(DAY), ...within(cell(DAY)).getAllByRole("link"), ...within(cell(DAY)).getAllByRole("button")];
    expect(own).toHaveLength(1 + 2 + 4);
    for (const el of own) {
      expect(el.className).toContain("min-h-11");
      expect(el.className).toContain("min-w-11");
    }
  });

  it("Phone month cell: cards and '+N más' are CSS-hidden below md; the day number link and the count stay", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(5)} />);
    const c = within(cell(DAY));
    expect(c.getByRole("list").className).toContain("max-md:hidden");
    expect(c.getByRole("link", { name: "+2 más" }).className).toContain("max-md:hidden");
    expect(c.getByRole("link", { name: "15" }).className).not.toContain("max-md:hidden");
    expect(c.getByText("5 citas").parentElement!.className).toContain("md:hidden");
  });

  it("Narrow columns: a card is clipped and truncates its text instead of widening the cell", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(1)} />);
    const [card] = cards(DAY);
    expect(card.className).toContain("overflow-hidden");
    expect(card.querySelector(".truncate")).not.toBeNull();
  });

  it("Count is visible text plus sr-only text, not an aria-label on a plain span", () => {
    const { container } = render(<MonthView date={DAY} today="2026-01-01" items={at(2)} />);
    const count = within(cell(DAY)).getByText("2 citas").closest("span")!.parentElement!;
    expect(count.className).toContain("md:hidden");
    expect(within(cell(DAY)).getByText("2 citas").className).toContain("sr-only");
    expect(within(count).getByText("2")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("span[aria-label]")).toBeNull();
  });

  it("Month cell prefill: the cell '+' asks for a booking on its own day, with no time; without onSlot there is none", async () => {
    const onSlot = vi.fn();
    const { unmount } = render(<MonthView date={DAY} today="2026-01-01" items={[]} onSlot={onSlot} />);
    await userEvent.click(within(cell("2026-10-20")).getByRole("button", { name: "Nueva cita el 20/10" }));
    expect(onSlot).toHaveBeenCalledExactlyOnceWith("2026-10-20");
    unmount();
    render(<MonthView date={DAY} today="2026-01-01" items={[]} />);
    expect(screen.queryByRole("button", { name: /^Nueva cita/ })).not.toBeInTheDocument();
  });

  it("Cell header: the day number and the '+' share one row, number first", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={[]} onSlot={() => {}} />);
    const number = within(cell(DAY)).getByRole("link", { name: "15" });
    const plus = within(cell(DAY)).getByRole("button", { name: "Nueva cita el 15/10" });
    expect(plus.parentElement).toBe(number.parentElement);
    expect(number.parentElement!.className).toContain("justify-between");
    expect(number.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Weekends are hatched like the week grid: Saturday and Sunday cells only", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={[]} />);
    const hatched = screen.getAllByTestId(/^cell-/).filter((c) => c.className.includes("agenda-hatch")).map((c) => c.getAttribute("data-testid"));
    expect(hatched).toEqual(["cell-2026-10-03", "cell-2026-10-04", "cell-2026-10-10", "cell-2026-10-11", "cell-2026-10-17", "cell-2026-10-18", "cell-2026-10-24", "cell-2026-10-25", "cell-2026-10-31", "cell-2026-11-01"]);
    expect(cell("2026-10-03")).toHaveAttribute("data-weekend");
    expect(cell("2026-10-05")).not.toHaveAttribute("data-weekend");
  });

  it("Phone count is a pill: visible digits on a rounded muted background", () => {
    render(<MonthView date={DAY} today="2026-01-01" items={at(2)} />);
    const digits = within(cell(DAY)).getByText("2");
    expect(digits).toHaveAttribute("aria-hidden", "true");
    expect(digits.className).toContain("rounded-full");
    expect(digits.className).toContain("bg-muted");
  });
});
