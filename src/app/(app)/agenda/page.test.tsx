/**
 * /agenda is a Server Component: authorize, resolve the params, read the range with the caller's
 * scope, render server views. The queries module is mocked with the real row shape.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
const agendaRange = vi.hoisted(() => vi.fn());
const orderScope = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));
vi.mock("@/modules/agenda/queries", () => ({ agendaRange }));
vi.mock("@/modules/service-orders/scope", () => ({ orderScope }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AgendaPage from "./page";

const params = (q: Record<string, string | string[]> = {}) => ({ searchParams: Promise.resolve(q) });
const SCOPE = { where: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  orderScope.mockReturnValue(SCOPE);
  agendaRange.mockResolvedValue({ rows: [], truncated: false });
});

describe("AgendaPage access", () => {
  it("Técnico is denied: the denial screen, and no agenda query runs", async () => {
    session.mockResolvedValue({ id: "t", role: "tecnico" });

    render(await AgendaPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(agendaRange).not.toHaveBeenCalled();
  });

  it("Pantalla never sees the agenda: invoked directly it is denied too", async () => {
    session.mockResolvedValue({ id: "p", role: "pantalla" });

    render(await AgendaPage(params()));

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(agendaRange).not.toHaveBeenCalled();
  });

  it.each([["administrador"], ["jefe_taller"]])("%s gets the page, not the denial", async (role) => {
    session.mockResolvedValue({ id: "x", role });

    render(await AgendaPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.queryByText("No tenés permiso para ver esta página")).not.toBeInTheDocument();
  });
});

describe("AgendaPage data", () => {
  beforeEach(() => session.mockResolvedValue({ id: "a", role: "administrador" }));

  it("Invalid params fall back: garbage renders the week without throwing", async () => {
    render(await AgendaPage(params({ view: "year", date: "2026-13-45" })));

    expect(screen.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");
    expect(agendaRange).toHaveBeenCalledTimes(1);
  });

  it("Invalid params fall back: repeated query keys (arrays) do not throw either", async () => {
    render(await AgendaPage(params({ view: ["day", "week"], date: ["2026-10-26", "2026-10-27"] })));

    expect(screen.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");
  });

  it("Range Query: scope: the range is read with orderScope(user) and the half-open Panama bounds", async () => {
    const user = { id: "a", role: "administrador" };
    session.mockResolvedValue(user);

    render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

    expect(orderScope).toHaveBeenCalledWith(user);
    const [scope, range] = agendaRange.mock.calls[0];
    expect(scope).toBe(SCOPE);
    expect(range.from.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-27T05:00:00.000Z");
  });

  it("renders the rows as chips and discloses a truncated range", async () => {
    agendaRange.mockResolvedValue({
      truncated: true,
      rows: [
        { id: "o1", status: "booked", appointmentAt: new Date("2026-10-26T19:05:00Z"), customerName: "Pérez", customerPhone: "61234567", vehiclePlate: null },
      ],
    });

    render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

    expect(screen.getByRole("link", { name: /Pérez/ })).toHaveAttribute("href", "/service-orders/o1");
    expect(screen.getByText("Sin vehículo")).toBeInTheDocument();
    expect(screen.getByText("Se muestran las primeras 500 citas; acotá el rango.")).toBeInTheDocument();
  });

  it("Flag is computed once on the server: now is captured once and decides Vencida for every row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
    try {
      agendaRange.mockResolvedValue({
        truncated: false,
        rows: [
          { id: "late", status: "booked", appointmentAt: new Date("2026-10-26T18:00:00Z"), customerName: "Tarde", customerPhone: "1", vehiclePlate: "X" },
          { id: "soon", status: "booked", appointmentAt: new Date("2026-10-26T19:30:00Z"), customerName: "Casi", customerPhone: "2", vehiclePlate: "Y" },
        ],
      });

      render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

      expect(screen.getAllByText("Vencida")).toHaveLength(1);
      expect(screen.getByRole("link", { name: /Tarde/ }).textContent).toContain("Vencida");
    } finally {
      vi.useRealTimers();
    }
  });

  it("view=month draws the month grid for the whole drawn range", async () => {
    render(await AgendaPage(params({ view: "month", date: "2026-10-15" })));

    expect(screen.getAllByTestId(/^cell-/)).toHaveLength(35);
    const [, range] = agendaRange.mock.calls[0];
    expect(range.from.toISOString()).toBe("2026-09-28T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
