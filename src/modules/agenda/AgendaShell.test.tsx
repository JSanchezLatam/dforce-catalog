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

const base = { date: DAY, today: DAY, nowMinute: 10 * 60 + 40, workshop: null, workshopTruncated: false, roster: null, overdueTotal: 0, overdue: [], overdueTruncated: false, truncated: false, weekSummary: [], busyDays: [], next: null } as const;

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

  it("month renders the month grid", () => {
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
    try {
      render(<AgendaShell {...base} view="week" items={[at("a", { status: "booked", categoria: null }), at("b", { status: "booked", time: "11:00", minuteOfDay: 11 * 60 })]} />);
      await userEvent.click(card(/Cliente a/));
      await userEvent.click(within(popover()!).getByRole("button", { name: "Reparación" }));
      expect(await within(popover()!).findByRole("alert")).toHaveTextContent("La orden cambió");
      await userEvent.click(card(/Cliente b/));
      expect(within(popover()!).getByText("Cliente b")).toBeInTheDocument();
      expect(within(popover()!).queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("switching to the month view (same shell instance) drops an open Detail instead of floating it over the month grid", async () => {
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

  it("month: a card opens the Detail and the cell '+' opens the booking dialog on that day with no time", async () => {
    render(<AgendaShell {...base} view="month" items={[at("a", { vehicleLabel: "Sin vehículo" })]} />);
    expect(popover()).toBeNull();
    await userEvent.click(card(/Cliente/));
    expect(card(/Cliente/)).toHaveAttribute("aria-pressed", "true");
    expect(within(popover()!).getByText("Cliente a")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Nueva cita el 20/10" }));
    expect((screen.getByLabelText("Día") as HTMLInputElement).value).toBe("2026-10-20");
    expect((screen.getByLabelText("Hora") as HTMLInputElement).value).toBe("");
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

  describe("Vencidas tab", () => {
    const old = makeItem({ id: "old", customerName: "Vieja", dayKey: "2026-09-12", time: "09:30", overdue: true });
    const newer = makeItem({ id: "new", customerName: "Nueva", dayKey: "2026-10-20", time: "16:00", overdue: true });
    const vencidas = () => userEvent.click(screen.getByRole("tab", { name: /Vencidas/ }));

    it("Vencidas list row: every Vencida oldest first, each with its full date as digits and the card fields", async () => {
      render(<AgendaShell {...base} overdueTotal={2} overdue={[old, newer]} view="week" items={[at("a")]} />);
      await vencidas();
      const rows = screen.getAllByRole("listitem");
      expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("12/09/2026 09:30"), expect.stringContaining("20/10/2026 16:00")]);
      expect(rows[0].textContent).toMatch(/Vieja.*AB1234.*Vencida/);
      expect(screen.queryByRole("button", { name: /Cliente a/ })).not.toBeInTheDocument();
    });

    it("a row opens the Detail with its actions", async () => {
      render(<AgendaShell {...base} overdueTotal={1} overdue={[old]} view="month" items={[]} />);
      await vencidas();
      await userEvent.click(card(/Vieja/));
      expect(card(/Vieja/)).toHaveAttribute("aria-pressed", "true");
      expect(within(popover()!).getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
      expect(within(popover()!).getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    });

    it("Empty state: no Vencida order shows 'Sin citas vencidas'", async () => {
      render(<AgendaShell {...base} view="day" items={[]} />);
      await vencidas();
      expect(screen.getByText("Sin citas vencidas")).toBeInTheDocument();
    });

    it("Vencidas list is capped and disclosed: the notice shows only when truncated", async () => {
      const { rerender } = render(<AgendaShell {...base} overdueTotal={501} overdue={[old]} view="day" items={[]} />);
      await vencidas();
      expect(screen.queryByText("Se muestran las primeras 500 citas vencidas.")).not.toBeInTheDocument();
      rerender(<AgendaShell {...base} overdueTotal={501} overdue={[old]} overdueTruncated view="day" items={[]} />);
      expect(screen.getByText("Se muestran las primeras 500 citas vencidas.")).toBeInTheDocument();
    });

    it("the search covers the list; nothing matching says 'Sin resultados' (and the badge stays the true total)", async () => {
      render(<AgendaShell {...base} overdueTotal={2} overdue={[old, newer]} view="day" items={[]} />);
      await vencidas();
      fireEvent.change(screen.getByPlaceholderText("Buscar placa o cliente…"), { target: { value: "nueva" } });
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      fireEvent.change(screen.getByPlaceholderText("Buscar placa o cliente…"), { target: { value: "zzzz" } });
      expect(screen.getByText("Sin resultados")).toBeInTheDocument();
      expect(screen.queryByText("Sin citas vencidas")).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Vencidas/ })).toHaveTextContent("2");
    });
  });

  it("a view change closes the open Detail: a trip to month and back does not reopen it on a stale anchor", async () => {
    const { rerender } = render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    expect(popover()).not.toBeNull();
    rerender(<AgendaShell {...base} view="month" items={[at("a")]} />);
    rerender(<AgendaShell {...base} view="day" items={[at("a")]} />);
    expect(popover()).toBeNull();
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false");
  });

  it("a date change closes the open Detail too: the same order on another day is a new card", async () => {
    const { rerender } = render(<AgendaShell {...base} view="day" items={[at("a")]} />);
    await userEvent.click(card(/Cliente a/));
    rerender(<AgendaShell {...base} date="2026-10-28" view="day" items={[at("a")]} />);
    expect(popover()).toBeNull();
    expect(card(/Cliente a/)).toHaveAttribute("aria-pressed", "false");
  });

  it.each(["day", "week", "month", "combined"] as const)("one empty message: %s emptied by the search says 'Sin resultados' alone", (view) => {
    render(<AgendaShell {...base} view={view} items={[at("a")]} />);
    fireEvent.change(screen.getByPlaceholderText("Buscar placa o cliente…"), { target: { value: "zzzz" } });
    expect(screen.getAllByText("Sin resultados")).toHaveLength(1);
    expect(screen.queryByText("Sin citas para este día")).not.toBeInTheDocument();
  });

  describe("calendar and Próxima cita", () => {
    it("the column holds the mini calendar (links keep the view) and the Próxima cita card, before the filter", () => {
      render(<AgendaShell {...base} view="week" items={[]} busyDays={["2026-10-05"]} next={{ item: makeItem({ id: "n", customerName: "Jorge Vega" }), label: "en 20 min" }} />);
      expect(screen.getByRole("link", { name: "Mes siguiente" })).toHaveAttribute("href", "/agenda?view=week&date=2026-11-01");
      expect(screen.getByText("con citas")).toBeInTheDocument();
      expect(screen.getByText("Próxima cita · en 20 min")).toBeInTheDocument();
      const text = document.body.textContent ?? "";
      expect(text.indexOf("Próxima cita")).toBeLessThan(text.indexOf("Categoría"));
    });

    it("with no next appointment the card says so", () => {
      render(<AgendaShell {...base} view="day" items={[]} />);
      expect(screen.getByText("Sin citas próximas")).toBeInTheDocument();
    });
  });

  describe("side column", () => {
    const items = [
      at("a", { categoria: "revisado" }),
      at("b", { categoria: "reparacion", time: "11:00", minuteOfDay: 11 * 60 }),
      at("c", { categoria: null, time: "12:00", minuteOfDay: 12 * 60 }),
    ];
    const box = (name: RegExp) => screen.getByRole("checkbox", { name });

    it("Esta semana shows the summary the page computed", () => {
      render(<AgendaShell {...base} view="day" items={[]} weekSummary={[{ label: "Agendadas", count: 5 }, { label: "Vencidas", count: 2 }]} />);
      const week = within(screen.getByRole("region", { name: "Esta semana" }));
      expect(week.getByText("Agendadas").parentElement).toHaveTextContent("Agendadas5");
      expect(week.getByText("Vencidas").parentElement).toHaveTextContent("Vencidas2");
    });

    it("Unchecking hides a type: its cards go, the counts and the other cards stay", async () => {
      render(<AgendaShell {...base} view="week" items={items} />);
      await userEvent.click(box(/REVISADO/));
      expect(screen.queryByRole("button", { name: /Cliente a/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Cliente b/ })).toBeInTheDocument();
      expect(box(/REVISADO/)).not.toBeChecked();
      expect(box(/REVISADO/)).toHaveAccessibleName("REVISADO 1");
      await userEvent.click(box(/REVISADO/));
      expect(box(/REVISADO/)).toBeChecked();
      expect(screen.getByRole("button", { name: /Cliente a/ })).toBeInTheDocument();
    });

    it("Type counts do not follow the search", () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      fireEvent.change(screen.getByPlaceholderText("Buscar placa o cliente…"), { target: { value: "Cliente b" } });
      expect(box(/REVISADO/)).toHaveAccessibleName("REVISADO 1");
      expect(box(/Sin categoría/)).toHaveAccessibleName("Sin categoría 1");
    });

    it("the Agendadas badge counts the cards the filter leaves", async () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      expect(screen.getByRole("tab", { name: /Agendadas/ })).toHaveTextContent("3");
      await userEvent.click(box(/REVISADO/));
      expect(screen.getByRole("tab", { name: /Agendadas/ })).toHaveTextContent("2");
    });

    it("Todos resets: every type is checked again and the cards return", async () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      await userEvent.click(box(/REVISADO/));
      await userEvent.click(box(/Reparación/));
      await userEvent.click(screen.getByRole("button", { name: "Todos" }));
      for (const b of screen.getAllByRole("checkbox")) expect(b).toBeChecked();
      expect(screen.getAllByRole("button", { name: /Cliente/ })).toHaveLength(3);
    });

    it("the filter covers the Vencidas list too", async () => {
      const late = (id: string, categoria: "revisado" | "reparacion") => makeItem({ id, customerName: `Tarde ${id}`, categoria, overdue: true });
      render(<AgendaShell {...base} overdueTotal={2} overdue={[late("x", "revisado"), late("y", "reparacion")]} view="day" items={[]} />);
      await userEvent.click(screen.getByRole("tab", { name: /Vencidas/ }));
      await userEvent.click(box(/REVISADO/));
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByRole("tab", { name: /Vencidas/ })).toHaveTextContent("2");
    });

    it("a card hidden by the filter closes its Detail", async () => {
      render(<AgendaShell {...base} view="day" items={items} />);
      await userEvent.click(card(/Cliente a/));
      fireEvent.click(box(/REVISADO/));
      expect(popover()).toBeNull();
    });
  });

  describe("Nueva cita", () => {
    const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

    it("the header button opens the dialog on the selected date with an empty time", async () => {
      render(<AgendaShell {...base} date="2026-11-05" view="week" items={[]} />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Nueva cita" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(field("Día").value).toBe("2026-11-05");
      expect(field("Hora").value).toBe("");
    });

    it.each(["day", "week", "combined"] as const)("an empty %s slot opens the dialog with its day and hour", async (view) => {
      render(<AgendaShell {...base} date="2026-10-29" view={view} items={[at("a", { dayKey: "2026-10-29" })]} />);
      await userEvent.click(screen.getAllByRole("button", { name: "Nueva cita 29/10/2026 11:00" })[0]);
      expect(field("Día").value).toBe("2026-10-29");
      expect(field("Hora").value).toBe("11:00");
    });

    it("a second opening starts clean: the day and time of the new opening, not the previous one", async () => {
      render(<AgendaShell {...base} date="2026-10-29" view="day" items={[]} />);
      await userEvent.click(screen.getByRole("button", { name: "Nueva cita 29/10/2026 11:00" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "Nueva cita" }));
      expect(field("Hora").value).toBe("");
    });
  });
});
