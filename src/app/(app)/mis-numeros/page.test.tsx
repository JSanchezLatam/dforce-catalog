/**
 * /mis-numeros is a Server Component: the técnico's own numbers. The roster id
 * comes ONLY from the session; queries are mocked at the module boundary with
 * the rows' real wire shape (`n` is an int cast in SQL, never a string).
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const q = vi.hoisted(() => ({ closedByTecnicoMonth: vi.fn(), minutesByTecnicoMonth: vi.fn() }));
vi.mock("@/modules/metrics/queries", () => q);

const findTecnicoByUserId = vi.hoisted(() => vi.fn());
vi.mock("@/modules/technicians/queries", () => ({ findTecnicoByUserId }));

const charts = vi.hoisted(() => ({ hours: vi.fn() }));
vi.mock("@/modules/metrics/charts/HoursBarChart", () => ({
  HoursBarChart: (props: unknown) => {
    charts.hours(props);
    return <div data-testid="hours-chart" />;
  },
}));

import MisNumerosPage from "./page";

const tecnico = { id: "u-1", role: "tecnico" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.clearAllMocks();
  session.mockResolvedValue(tecnico);
  findTecnicoByUserId.mockResolvedValue({ id: "t-A" });
  q.closedByTecnicoMonth.mockResolvedValue([
    { tecnicoId: "t-A", mes: "2026-10", n: 3 },
    { tecnicoId: "t-A", mes: "2026-08", n: 4 },
  ]);
  q.minutesByTecnicoMonth.mockResolvedValue([
    { tecnicoId: "t-A", mes: "2026-10", n: 270 },
    { tecnicoId: "t-A", mes: "2026-08", n: 60 },
  ]);
});

afterEach(() => vi.useRealTimers());

const render_ = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  render(await MisNumerosPage({ searchParams: Promise.resolve(searchParams) }));

describe("MisNumerosPage", () => {
  it.each(["administrador", "jefe_taller"])("refuses %s with the denial screen and reads nothing", async (role) => {
    session.mockResolvedValue({ id: "u", role });

    await render_();

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(findTecnicoByUserId).not.toHaveBeenCalled();
    expect(q.closedByTecnicoMonth).not.toHaveBeenCalled();
  });

  it("resolves the roster id from the session user and queries with it", async () => {
    await render_();

    expect(findTecnicoByUserId).toHaveBeenCalledWith("u-1");
    expect(q.closedByTecnicoMonth).toHaveBeenCalledWith(expect.objectContaining({ tecnicoId: "t-A" }));
    expect(q.minutesByTecnicoMonth).toHaveBeenCalledWith(expect.objectContaining({ tecnicoId: "t-A" }));
  });

  it("ignores a forged tecnicoId / tecnico param and keeps the session's id", async () => {
    await render_({ tecnicoId: "t-B", tecnico: "t-B" });

    expect(q.closedByTecnicoMonth).toHaveBeenCalledTimes(1);
    expect(q.closedByTecnicoMonth).toHaveBeenCalledWith(expect.objectContaining({ tecnicoId: "t-A" }));
    expect(q.minutesByTecnicoMonth).toHaveBeenCalledWith(expect.objectContaining({ tecnicoId: "t-A" }));
  });

  it("teaches an unlinked técnico what to do, with no error and no query", async () => {
    findTecnicoByUserId.mockResolvedValue(null);

    await render_();

    expect(screen.getByText("Todavía no estás en la lista de técnicos. Pedile al jefe de taller que te agregue.")).toBeInTheDocument();
    expect(q.closedByTecnicoMonth).not.toHaveBeenCalled();
    expect(q.minutesByTecnicoMonth).not.toHaveBeenCalled();
  });

  it("shows the selected month's closed orders and hours, with the month select", async () => {
    await render_();

    const month = screen.getByRole("region", { name: /Octubre 2026/ });
    expect(within(month).getByText("3")).toBeInTheDocument();
    expect(within(month).getByText("4.5 h")).toBeInTheDocument();
    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
  });

  it("honours a valid ?mes, up to 11 months back, and widens the query window to it", async () => {
    await render_({ mes: "2025-11" });

    expect(screen.getByRole("region", { name: /Noviembre 2025/ })).toBeInTheDocument();
    expect(q.closedByTecnicoMonth).toHaveBeenCalledWith({ from: "2025-11", tecnicoId: "t-A" });
  });

  it("falls back to the current month on a garbage ?mes", async () => {
    await render_({ mes: "9999-99" });

    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
  });

  it("carries every plotted value as text: 6 months of closed orders and hours, zero-filled, newest first", async () => {
    await render_();

    const table = screen.getByRole("table", { name: /Últimos 6 meses/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(within(rows[0]).getByText("Octubre 2026")).toBeInTheDocument();
    expect(within(rows[0]).getByText("3")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4.5 h")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Agosto 2026")).toBeInTheDocument();
    expect(within(rows[2]).getByText("4")).toBeInTheDocument();
    expect(within(rows[2]).getByText("1 h")).toBeInTheDocument();
    expect(within(rows[1]).getByText("0")).toBeInTheDocument();
  });

  it("hands the hours chart plain per-month data, oldest first, and shows no currency", async () => {
    const { container } = await render_();

    const props = charts.hours.mock.calls[0][0] as { bars: { key: string; value: number }[] };
    expect(props.bars.map((b) => b.key)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(props.bars.map((b) => b.value)).toEqual([0, 0, 0, 1, 0, 4.5]);
    expect(Object.values(props).every((v) => typeof v !== "function")).toBe(true);
    expect(container.textContent).not.toMatch(/\$|USD|B\//);
  });
});
