/**
 * /metrics is a Server Component: it authorizes, runs the queries and hands plain
 * data to presentational pieces. Queries are mocked at the module boundary with
 * the rows' real wire shape (`n` is an int cast in SQL, never a string).
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const q = vi.hoisted(() => ({
  backlogByStatus: vi.fn(),
  receivedByMonth: vi.fn(),
  closedByMonth: vi.fn(),
  closedByTecnicoMonth: vi.fn(),
  minutesByTecnicoMonth: vi.fn(),
}));
vi.mock("@/modules/metrics/queries", () => q);

const listTecnicos = vi.hoisted(() => vi.fn());
vi.mock("@/modules/technicians/queries", () => ({ listTecnicos }));

// The wrappers wrap Arc and are client components; here they only record the props
// the page hands them, so the page's own contract (plain data, in order) is what is tested.
const charts = vi.hoisted(() => ({ trend: vi.fn(), hours: vi.fn(), backlog: vi.fn() }));
vi.mock("@/modules/metrics/charts/TrendChart", () => ({
  TrendChart: (props: unknown) => {
    charts.trend(props);
    return <div data-testid="trend-chart" />;
  },
}));
vi.mock("@/modules/metrics/charts/HoursBarChart", () => ({
  HoursBarChart: (props: unknown) => {
    charts.hours(props);
    return <div data-testid="hours-chart" />;
  },
}));
vi.mock("@/modules/metrics/charts/BacklogCounters", () => ({
  BacklogCounters: (props: unknown) => {
    charts.backlog(props);
    return <div data-testid="backlog-counters" />;
  },
}));

import MetricsPage from "./page";

const admin = { id: "a", role: "administrador" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.clearAllMocks();
  q.backlogByStatus.mockResolvedValue([
    { status: "open", n: 7 },
    { status: "in_progress", n: 3 },
  ]);
  q.receivedByMonth.mockResolvedValue([
    { mes: "2026-10", n: 12 },
    { mes: "2026-09", n: 20 },
  ]);
  q.closedByMonth.mockResolvedValue([{ mes: "2026-10", n: 9 }]);
  q.closedByTecnicoMonth.mockResolvedValue([
    { tecnicoId: "t-1", mes: "2026-10", n: 3 },
    { tecnicoId: "t-2", mes: "2026-10", n: 5 },
    { tecnicoId: "t-2", mes: "2026-08", n: 4 },
  ]);
  q.minutesByTecnicoMonth.mockResolvedValue([
    { tecnicoId: "t-1", mes: "2026-10", n: 270 },
    { tecnicoId: "t-2", mes: "2026-08", n: 60 },
  ]);
  listTecnicos.mockResolvedValue([
    { id: "t-1", nombre: "Luis", deactivatedAt: null },
    { id: "t-2", nombre: "Zoe", deactivatedAt: null },
  ]);
});

afterEach(() => vi.useRealTimers());

const render_ = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  render(await MetricsPage({ searchParams: Promise.resolve(searchParams) }));

const technicianTable = () => screen.getByRole("table", { name: /Productividad por técnico/ });

describe("MetricsPage", () => {
  it("refuses a técnico with the denial screen and reads nothing", async () => {
    session.mockResolvedValue({ id: "u", role: "tecnico" });

    await render_();

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    for (const fn of Object.values(q)) expect(fn).not.toHaveBeenCalled();
    expect(listTecnicos).not.toHaveBeenCalled();
  });

  it.each([["administrador"], ["jefe_taller"]])("gives %s the open backlog counters, zero-filled", async (role) => {
    session.mockResolvedValue({ id: "x", role });

    await render_();

    expect(screen.getByRole("heading", { level: 1, name: "Métricas" })).toBeInTheDocument();
    expect(charts.backlog).toHaveBeenCalledWith({ counts: { open: 7, in_progress: 3, ready_for_review: 0 } });
  });

  it("lists six months of received and closed orders, newest first, zero-filled", async () => {
    session.mockResolvedValue(admin);

    await render_();

    const rows = within(screen.getByRole("table", { name: /Recibidas y cerradas/ })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Octubre 2026", "12", "9"],
      ["Septiembre 2026", "20", "0"],
      ["Agosto 2026", "0", "0"],
      ["Julio 2026", "0", "0"],
      ["Junio 2026", "0", "0"],
      ["Mayo 2026", "0", "0"],
    ]);
    expect(q.receivedByMonth).toHaveBeenCalledWith({ from: "2026-05" });
    expect(q.closedByMonth).toHaveBeenCalledWith({ from: "2026-05" });
  });

  it("shows the current month's productivity by default, most closed orders first", async () => {
    session.mockResolvedValue(admin);

    await render_();

    expect(screen.getByRole("heading", { name: "Productividad por técnico — Octubre 2026" })).toBeInTheDocument();
    const rows = within(technicianTable()).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Zoe", "5", "0 h"],
      ["Luis", "3", "4.5 h"],
    ]);
    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
  });

  it("honours ?mes=2026-08 for the table and the select", async () => {
    session.mockResolvedValue(admin);

    await render_({ mes: "2026-08" });

    expect(screen.getByRole("heading", { name: "Productividad por técnico — Agosto 2026" })).toBeInTheDocument();
    expect(within(technicianTable()).getByText("1 h")).toBeInTheDocument();
    expect(screen.getByLabelText("Mes")).toHaveValue("2026-08");
    expect(q.closedByTecnicoMonth).toHaveBeenCalledWith({ from: "2026-08" });
  });

  it.each([["garbage"], ["2019-01"], [["2026-08", "2026-09"]]])("falls back to the current month for ?mes=%j", async (mes) => {
    session.mockResolvedValue(admin);

    await render_({ mes });

    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
    expect(q.closedByTecnicoMonth).toHaveBeenCalledWith({ from: "2026-10" });
  });

  it("teaches what counts when the month has no closed orders", async () => {
    session.mockResolvedValue(admin);
    q.closedByTecnicoMonth.mockResolvedValue([]);
    q.minutesByTecnicoMonth.mockResolvedValue([]);

    await render_();

    expect(screen.getByText("Todavía no hay órdenes cerradas en Octubre 2026. Una orden cuenta cuando pasa a Completada.")).toBeInTheDocument();
  });

  it("links the empty roster to Técnicos only for a viewer who manages them", async () => {
    listTecnicos.mockResolvedValue([]);
    q.closedByTecnicoMonth.mockResolvedValue([]);
    q.minutesByTecnicoMonth.mockResolvedValue([]);

    session.mockResolvedValue({ id: "j", role: "jefe_taller" });
    await render_();
    expect(screen.getByRole("link", { name: "Técnicos" })).toHaveAttribute("href", "/technicians");
  });

  it("shows no currency amount anywhere", async () => {
    session.mockResolvedValue(admin);

    const { container } = await render_();

    expect(container.textContent).not.toMatch(/[$]|B\/\.|USD|PAB/);
  });

  describe("charts", () => {
    it("plots the six months oldest to newest, and every plotted value is also a table cell", async () => {
      session.mockResolvedValue(admin);

      await render_();

      const { points } = charts.trend.mock.calls[0][0] as {
        points: { key: string; label: string; axisLabel: string; received: number; closed: number }[];
      };
      expect(points.map((p) => [p.key, p.axisLabel, p.received, p.closed])).toEqual([
        ["2026-05", "May", 0, 0],
        ["2026-06", "Jun", 0, 0],
        ["2026-07", "Jul", 0, 0],
        ["2026-08", "Ago", 0, 0],
        ["2026-09", "Sep", 20, 0],
        ["2026-10", "Oct", 12, 9],
      ]);
      const rows = within(screen.getByRole("table", { name: /Recibidas y cerradas/ })).getAllByRole("row").slice(1);
      const cells = new Map(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent)).map(([mes, rec, cer]) => [mes, [rec, cer]]));
      for (const p of points) expect(cells.get(p.label)).toEqual([String(p.received), String(p.closed)]);
    });

    it("plots hours per técnico for the selected month, each also in the table", async () => {
      session.mockResolvedValue(admin);

      await render_();

      const { bars, mesLabel } = charts.hours.mock.calls[0][0] as { bars: { key: string; label: string; axisLabel: string; value: number }[]; mesLabel: string };
      expect(mesLabel).toBe("Octubre 2026");
      expect(bars).toEqual([
        { key: "t-1", label: "Luis", axisLabel: "Luis", value: 4.5 },
        { key: "t-2", label: "Zoe", axisLabel: "Zoe", value: 0 },
      ]);
      expect(within(technicianTable()).getByText("4.5 h")).toBeInTheDocument();
    });

    it("passes only plain serializable props: no function crosses the RSC boundary", async () => {
      session.mockResolvedValue(admin);

      await render_();

      for (const fn of Object.values(charts)) {
        const props = fn.mock.calls[0][0];
        expect(JSON.parse(JSON.stringify(props))).toEqual(props);
      }
    });
  });
});
