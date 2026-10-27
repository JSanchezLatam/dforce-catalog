import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgendaShell } from "./AgendaShell";
import { makeItem, makeWorkshopItem } from "./items.fixture";

const DAY = "2026-10-27";
const at = (id: string, over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ id, dayKey: DAY, customerName: `Cliente ${id}`, time: "09:00", minuteOfDay: 9 * 60, ...over });

const base = { date: DAY, today: DAY, nowMinute: 10 * 60 + 40, workshop: null, workshopTruncated: false } as const;

describe("AgendaShell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("day renders the day grid: hour rows, and a card per appointment", () => {
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cliente a/ })).toBeInTheDocument();
    expect(document.querySelector("[data-day-column]")).toBeNull();
  });

  it("week renders the week grid: seven day columns from the Monday of the date", () => {
    const { container } = render(<AgendaShell {...base} view="week" items={[at("a")]} />);
    const days = [...container.querySelectorAll("[data-day-column]")].map((c) => c.getAttribute("data-day-column"));
    expect(days).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(screen.getByRole("button", { name: /Cliente a/ })).toBeInTheDocument();
  });

  it("month keeps the legacy month grid", () => {
    render(<AgendaShell {...base} view="month" items={[at("a")]} />);
    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(35);
  });

  it("combined renders the day's grid beside the in-workshop list", () => {
    render(<AgendaShell {...base} view="combined" items={[at("a")]} workshop={[makeWorkshopItem({ customerName: "Taller Uno" })]} />);
    const day = screen.getByRole("region", { name: "Citas del día" });
    expect(within(day).getByRole("button", { name: /Cliente a/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "En el taller" })).getByText("Taller Uno")).toBeInTheDocument();
  });

  it("the now-line comes from the nowMinute the page captured", () => {
    render(<AgendaShell {...base} view="day" items={[]} />);
    expect(document.querySelector("[data-now-line]")).toHaveTextContent("10:40");
  });

  it("activating a card marks it aria-pressed, and activating it again clears it", async () => {
    render(<AgendaShell {...base} view="week" items={[at("a"), at("b", { time: "11:00", minuteOfDay: 11 * 60 })]} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente a/ }));
    expect(screen.getByRole("button", { name: /Cliente a/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cliente b/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: /Cliente b/ }));
    expect(screen.getByRole("button", { name: /Cliente a/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: /Cliente b/ }));
    expect(screen.getByRole("button", { name: /Cliente b/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("nothing selected: no selection bar", () => {
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    expect(screen.queryByRole("region", { name: "Cita seleccionada" })).not.toBeInTheDocument();
  });

  it("a selected booked card offers Abrir orden and Reprogramar; a Vencida one adds No se presentó", async () => {
    const { unmount } = render(<AgendaShell {...base} view="day" items={[at("a", { href: "/service-orders/a" })]} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente a/ }));
    const bar = screen.getByRole("region", { name: "Cita seleccionada" });
    const open = within(bar).getByRole("link", { name: "Abrir orden" });
    expect(open).toHaveAttribute("href", "/service-orders/a");
    expect(open).toHaveClass("min-h-11");
    expect(within(bar).getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
    unmount();
    render(<AgendaShell {...base} view="day" items={[at("v", { overdue: true })]} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente v/ }));
    expect(within(screen.getByRole("region", { name: "Cita seleccionada" })).getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
  });

  it("a selected muted card offers Abrir orden only", async () => {
    render(<AgendaShell {...base} view="day" items={[at("r", { status: "open", statusLabel: "Recibida", muted: true })]} />);
    await userEvent.click(screen.getByRole("button", { name: /Cliente r/ }));
    const bar = screen.getByRole("region", { name: "Cita seleccionada" });
    expect(within(bar).getByRole("link", { name: "Abrir orden" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Reprogramar" })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
  });
});
