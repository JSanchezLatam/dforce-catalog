import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { AgendaShell } from "./AgendaShell";
import { makeItem, makeWorkshopItem } from "./items.fixture";

const DAY = "2026-10-27";
const at = (id: string, over: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ id, dayKey: DAY, customerName: `Cliente ${id}`, time: "09:00", minuteOfDay: 9 * 60, ...over });

const base = { date: DAY, today: DAY, nowMinute: 10 * 60 + 40, workshop: null, workshopTruncated: false, roster: null, overdueTotal: 0 } as const;

/** jsdom matches no media query: the width is whatever the test says, and the query is recorded. */
function setWidth(wide: boolean) {
  const matchMedia = vi.fn((query: string) => ({ matches: wide && query === "(min-width: 768px)", media: query }) as MediaQueryList);
  window.matchMedia = matchMedia;
  return matchMedia;
}
const popover = () => document.querySelector('[data-slot="popover-content"]') as HTMLElement | null;
const sheet = () => document.querySelector('[data-slot="sheet-content"]') as HTMLElement | null;
// `hidden`: a modal sheet or dialog marks the page behind it aria-hidden, and the card is still the thing under test.
const card = (name: RegExp) => screen.getByRole("button", { name, hidden: true });

describe("AgendaShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWidth(true);
  });

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

  it("activating a card marks it aria-pressed and opens its Detail; another card moves both", async () => {
    render(<AgendaShell {...base} view="week" items={[at("a"), at("b", { time: "11:00", minuteOfDay: 11 * 60 })]} />);
    expect(popover()).toBeNull();
    await userEvent.click(card(/Cliente a/));
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "true");
    expect(within(popover()!).getByText("Cliente a")).toBeInTheDocument();
    await userEvent.click(card(/Cliente b/));
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false");
    expect(card(/Cliente b/)).toHaveAttribute("aria-pressed", "true");
    expect(within(popover()!).getByText("Cliente b")).toBeInTheDocument();
    expect(within(popover()!).queryByText("Cliente a")).not.toBeInTheDocument();
  });

  it("a new card gets a fresh Detail: the previous appointment's refusal does not follow it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgendaShell {...base} view="week" items={[at("a", { status: "booked", categoria: null }), at("b", { status: "booked", time: "11:00", minuteOfDay: 11 * 60 })]} />);
    await userEvent.click(card(/Cliente a/));
    await userEvent.click(within(popover()!).getByRole("button", { name: "Reparación" }));
    expect(await within(popover()!).findByRole("alert")).toHaveTextContent("La orden cambió");
    await userEvent.click(card(/Cliente b/));
    expect(within(popover()!).getByText("Cliente b")).toBeInTheDocument();
    expect(within(popover()!).queryByRole("alert")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("activating the open card again keeps its Detail (it closes by Escape, outside press or Cerrar)", async () => {
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    await userEvent.click(card(/Cliente a/));
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "true");
    expect(within(popover()!).getByText("Cliente a")).toBeInTheDocument();
  });

  it("nothing selected: no Detail and no way to reach an appointment's actions", () => {
    render(<AgendaShell {...base} view="day" items={[at("a", { overdue: true })]} />);
    expect(popover()).toBeNull();
    expect(sheet()).toBeNull();
    expect(screen.queryByRole("region", { name: "Cita seleccionada" })).not.toBeInTheDocument();
    for (const name of ["Reprogramar", "No se presentó", "Abrir orden"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("the actions live only in the selected appointment's Detail: Abrir orden, Reprogramar, and No se presentó when Vencida", async () => {
    const { unmount } = render(<AgendaShell {...base} view="day" items={[at("a", { href: "/service-orders/a" })]} />);
    await userEvent.click(card(/Cliente a/));
    const detail = within(popover()!);
    expect(detail.getAllByRole("link", { name: "Abrir orden" })[0]).toHaveAttribute("href", "/service-orders/a");
    expect(detail.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(detail.queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
    unmount();
    render(<AgendaShell {...base} view="day" items={[at("v", { overdue: true })]} />);
    await userEvent.click(card(/Cliente v/));
    expect(within(popover()!).getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
  });

  it("a selected muted card offers Abrir orden only", async () => {
    render(<AgendaShell {...base} view="day" items={[at("r", { status: "open", statusLabel: "Recibida", muted: true })]} />);
    await userEvent.click(card(/Cliente r/));
    const detail = within(popover()!);
    expect(detail.getAllByRole("link", { name: "Abrir orden" })).toHaveLength(2);
    expect(detail.queryByRole("button", { name: "Reprogramar" })).not.toBeInTheDocument();
    expect(detail.queryByRole("button", { name: "No se presentó" })).not.toBeInTheDocument();
  });

  it("width is read inside the click handler, never while rendering", async () => {
    const matchMedia = setWidth(true);
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    expect(matchMedia).not.toHaveBeenCalled();
    await userEvent.click(card(/Cliente a/));
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)");
  });

  it("from md up the Detail is a popover anchored on the card", async () => {
    setWidth(true);
    render(<AgendaShell {...base} view="week" items={[at("a")]} />);
    const rect = vi.spyOn(card(/Cliente a/), "getBoundingClientRect");
    await userEvent.click(card(/Cliente a/));
    expect(popover()).not.toBeNull();
    expect(sheet()).toBeNull();
    await waitFor(() => expect(rect).toHaveBeenCalled());
  });

  it("below md the Detail is a bottom sheet with our own 44px 'Cerrar' and not the stock English close", async () => {
    setWidth(false);
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    expect(popover()).toBeNull();
    expect(sheet()).toHaveAttribute("data-side", "bottom");
    expect(within(sheet()!).getByText("Cliente a")).toBeInTheDocument();
    expect(within(sheet()!).getAllByRole("button", { name: "Cerrar" })).toHaveLength(1);
    expect(within(sheet()!).getByRole("button", { name: "Cerrar" })).toHaveClass("min-h-11", "min-w-11");
    expect(within(sheet()!).queryByText("Close")).not.toBeInTheDocument();
  });

  it.each([
    ["popover", true],
    ["sheet", false],
  ])("Close affordances (%s): Escape and Cerrar close it and the card loses aria-pressed", async (_name, wide) => {
    setWidth(wide);
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(wide ? popover() : sheet()).toBeNull());
    await userEvent.click(card(/Cliente a/));
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(wide ? popover() : sheet()).toBeNull());
  });

  it("an outside press closes the popover", async () => {
    render(
      <>
        <button type="button">Fuera</button>
        <AgendaShell {...base} view="day" items={[at("a")]} />
      </>,
    );
    await userEvent.click(card(/Cliente a/));
    await userEvent.click(screen.getByRole("button", { name: "Fuera" }));
    await waitFor(() => expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false"));
    expect(popover()).toBeNull();
  });

  it("Reprogramar opens its dialog and the Detail stays mounted behind it", async () => {
    render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    await userEvent.click(within(popover()!).getByRole("button", { name: "Reprogramar" }));
    const dialog = screen.getByRole("dialog", { name: "Reprogramar cita" });
    await userEvent.click(within(dialog).getByLabelText("Día"));
    expect(screen.getByRole("dialog", { name: "Reprogramar cita" })).toBeInTheDocument();
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "true");
  });

  it("No se presentó opens its confirmation", async () => {
    render(<AgendaShell {...base} view="day" items={[at("v", { overdue: true })]} />);
    await userEvent.click(card(/Cliente v/));
    await userEvent.click(within(popover()!).getByRole("button", { name: "No se presentó" }));
    expect(screen.getByRole("dialog", { name: "¿El cliente no se presentó?" })).toBeInTheDocument();
  });

  it("switching to the month view (same shell instance) drops an open Detail instead of floating it over the legacy grid", async () => {
    const { rerender } = render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    expect(popover()).not.toBeNull();
    rerender(<AgendaShell {...base} view="month" items={[at("a")]} />);
    expect(popover()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it("the roster reaches the Detail: a booked card offers '+ Asignar técnico' only when the shell has one", async () => {
    const { unmount } = render(<AgendaShell {...base} view="day" items={[at("a")]} roster={[{ id: "t1", nombre: "Julio Rangel" }]} />);
    await userEvent.click(card(/Cliente a/));
    expect(within(popover()!).getByRole("button", { name: "+ Asignar técnico" })).toBeInTheDocument();
    unmount();
    render(<AgendaShell {...base} view="day" items={[at("a")]} roster={null} />);
    await userEvent.click(card(/Cliente a/));
    expect(within(popover()!).queryByRole("button", { name: "+ Asignar técnico" })).not.toBeInTheDocument();
  });

  it("month has no Detail yet: the legacy chips stay links", () => {
    render(<AgendaShell {...base} view="month" items={[at("a")]} />);
    expect(popover()).toBeNull();
    expect(sheet()).toBeNull();
  });

  describe("search and tabs", () => {
    const search = () => screen.getByPlaceholderText("Buscar placa o cliente…");
    const items = [
      at("a", { customerName: "Sofía Herrera", vehicleLabel: "AB1234 · Toyota Hilux" }),
      at("b", { customerName: "Pedro Sánchez", vehicleLabel: "CP8812 · Kia Rio", time: "11:00", minuteOfDay: 11 * 60 }),
      at("v", { customerName: "Vera Late", overdue: true, time: "12:00", minuteOfDay: 12 * 60 }),
    ];
    const names = () => screen.getAllByRole("button", { name: /Cliente|Sofía|Pedro|Vera/ }).map((b) => b.textContent);

    it("Tabs on every view: Todas, Agendadas and Vencidas with the true Vencidas count", () => {
      for (const view of ["day", "week", "month", "combined"] as const) {
        const { unmount } = render(<AgendaShell {...base} overdueTotal={1} view={view} items={[]} />);
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Todas", "Agendadas", "Vencidas1"]);
        unmount();
      }
    });

    it("Agendadas keeps the booked, not Vencida cards and its badge counts the cards left visible", async () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      expect(screen.getByRole("tab", { name: /Agendadas/ })).toHaveTextContent("2");
      await userEvent.click(screen.getByRole("tab", { name: /Agendadas/ }));
      expect(screen.queryByRole("button", { name: /Vera Late/ })).not.toBeInTheDocument();
      await userEvent.type(search(), "pedro");
      expect(screen.getByRole("tab", { name: /Agendadas/ })).toHaveTextContent("1");
      expect(screen.getByRole("button", { name: /Pedro/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Sofía/ })).not.toBeInTheDocument();
    });

    it("the Vencidas badge stays the true total whatever the search", async () => {
      render(<AgendaShell {...base} overdueTotal={7} view="day" items={items} />);
      await userEvent.type(search(), "pedro");
      expect(screen.getByRole("tab", { name: /Vencidas/ })).toHaveTextContent("7");
    });

    it("Search by plate: ab1234 shows only that card; a match outside the loaded range shows nothing and sends no request", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<AgendaShell {...base} view="day" items={items} />);
      await userEvent.type(search(), "ab 1234");
      expect(names().join()).toMatch(/Sofía/);
      expect(names().join()).not.toMatch(/Pedro/);
      await userEvent.clear(search());
      await userEvent.type(search(), "ZZ9999");
      expect(screen.getByText("Sin resultados")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("the search text survives a tab switch and back", async () => {
      render(<AgendaShell {...base} view="week" items={items} />);
      await userEvent.type(search(), "sofia");
      await userEvent.click(screen.getByRole("tab", { name: /Vencidas/ }));
      await userEvent.click(screen.getByRole("tab", { name: /Agendadas/ }));
      expect(search()).toHaveValue("sofia");
    });

    it("Shop list is unaffected: a search that matches nothing leaves 'En el taller ahora' whole", async () => {
      render(<AgendaShell {...base} view="combined" items={items} workshop={[makeWorkshopItem({ customerName: "Taller Uno" })]} />);
      await userEvent.type(search(), "zzzz");
      expect(screen.getByText("Sin resultados")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "En el taller" })).getByText("Taller Uno")).toBeInTheDocument();
    });

    it("an open Detail goes away when the search hides its card", async () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      await userEvent.click(card(/Sofía/));
      expect(popover()).not.toBeNull();
      // fireEvent, not a click into the field: a pointer press outside would close the popover by itself.
      fireEvent.change(search(), { target: { value: "pedro" } });
      expect(popover()).toBeNull();
    });
  });
});
