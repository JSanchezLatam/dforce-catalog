/**
 * /agenda is a Server Component: authorize, resolve the params, read the range with the caller's
 * scope, render server views. The queries module is mocked with the real row shape.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
const agendaRange = vi.hoisted(() => vi.fn());
const agendaOverdue = vi.hoisted(() => vi.fn());
const agendaInWorkshop = vi.hoisted(() => vi.fn());
const orderScope = vi.hoisted(() => vi.fn());
const listTecnicos = vi.hoisted(() => vi.fn());
const canMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));
vi.mock("@/modules/agenda/queries", () => ({ agendaRange, agendaOverdue, agendaInWorkshop }));
vi.mock("@/modules/service-orders/scope", () => ({ orderScope }));
vi.mock("@/modules/technicians/queries", () => ({ listTecnicos }));
const realCan = vi.hoisted(() => ({ fn: null as null | ((...args: never[]) => boolean) }));
vi.mock("@/modules/auth/policy", async (original) => {
  const real = await original<typeof import("@/modules/auth/policy")>();
  realCan.fn = real.can as never;
  canMock.mockImplementation(real.can);
  return { ...real, can: canMock };
});
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AgendaPage from "./page";
import { AgendaShell } from "@/modules/agenda/AgendaShell";
import type { AgendaRow, WorkshopRow } from "@/modules/agenda/queries";

// The wire shape of a query row; a test overrides only what it is about.
const agendaRow = (over: Partial<AgendaRow>): AgendaRow => ({
  id: "o",
  status: "booked",
  appointmentAt: new Date("2026-10-26T19:05:00Z"),
  customerName: "Pérez",
  customerPhone: "1",
  vehiclePlate: null,
  vehicleMake: null,
  vehicleModel: null,
  vehicleYear: null,
  categoria: null,
  description: null,
  noShow: false,
  technicians: [],
  ...over,
});

const workshopRow = (over: Partial<WorkshopRow>): WorkshopRow => ({
  id: "w",
  status: "in_progress",
  esperaMotivo: null,
  customerName: "Taller",
  customerPhone: "9",
  vehiclePlate: null,
  vehicleMake: null,
  vehicleModel: null,
  categoria: null,
  technicians: [],
  sinceAt: new Date("2026-10-26T18:00:00Z"),
  holdSinceAt: null,
  ...over,
});

/**
 * The RSC trap: whatever the page hands a client component must serialize. Walk the element tree for the shell
 * and refuse a function, a Date or any class instance in its props (jsdom renders them happily; Next refuses).
 */
function shellProps(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map(shellProps).find(Boolean) ?? null;
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as { type: unknown; props: { children?: unknown } & Record<string, unknown> };
  if (el.type === AgendaShell) return el.props;
  return shellProps(el.props.children);
}

function assertPlain(value: unknown, path = "props"): void {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (typeof value === "function") throw new Error(`${path} is a function`);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) return value.forEach((v, i) => assertPlain(v, `${path}[${i}]`));
  if (proto !== Object.prototype) throw new Error(`${path} is a ${proto?.constructor?.name ?? "non-plain object"}`);
  for (const [k, v] of Object.entries(value as object)) assertPlain(v, `${path}.${k}`);
}

const params = (q: Record<string, string | string[]> = {}) => ({ searchParams: Promise.resolve(q) });
const SCOPE = { where: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations: a test that denies one permission must not leak into the next.
  canMock.mockImplementation(realCan.fn!);
  orderScope.mockReturnValue(SCOPE);
  agendaRange.mockResolvedValue({ rows: [], truncated: false });
  agendaOverdue.mockResolvedValue({ rows: [], truncated: false, total: 0 });
  agendaInWorkshop.mockResolvedValue({ rows: [], truncated: false });
  // The real roster rows carry more than the Detail needs, and a Date among it.
  listTecnicos.mockResolvedValue([
    { id: "t1", nombre: "Julio Rangel", userId: "u1", deactivatedAt: null, createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "t2", nombre: "Marta Pérez", userId: null, deactivatedAt: null, createdAt: new Date("2026-01-02T00:00:00Z") },
  ]);
});

describe("AgendaPage access", () => {
  it("Técnico is denied: the denial screen, and no agenda query runs", async () => {
    session.mockResolvedValue({ id: "t", role: "tecnico" });

    render(await AgendaPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(agendaRange).not.toHaveBeenCalled();
    expect(agendaOverdue).not.toHaveBeenCalled();
    expect(agendaInWorkshop).not.toHaveBeenCalled();
    expect(listTecnicos).not.toHaveBeenCalled();
  });

  it("Pantalla never sees the agenda: invoked directly it is denied too", async () => {
    session.mockResolvedValue({ id: "p", role: "pantalla" });

    render(await AgendaPage(params()));

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(agendaRange).not.toHaveBeenCalled();
    expect(agendaOverdue).not.toHaveBeenCalled();
    expect(agendaInWorkshop).not.toHaveBeenCalled();
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

  it("renders the rows as cards and discloses a truncated range", async () => {
    agendaRange.mockResolvedValue({
      truncated: true,
      rows: [
        agendaRow({ id: "o1", appointmentAt: new Date("2026-10-26T19:05:00Z"), customerName: "Pérez", customerPhone: "61234567", vehiclePlate: null }),
      ],
    });

    render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

    expect(screen.getByRole("button", { name: /Pérez/ })).toBeInTheDocument();
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
          agendaRow({ id: "late", appointmentAt: new Date("2026-10-26T18:00:00Z"), customerName: "Tarde", customerPhone: "1", vehiclePlate: "X" }),
          agendaRow({ id: "soon", appointmentAt: new Date("2026-10-26T19:30:00Z"), customerName: "Casi", customerPhone: "2", vehiclePlate: "Y" }),
        ],
      });

      render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

      expect(screen.getAllByText("Vencida")).toHaveLength(1);
      expect(screen.getByRole("button", { name: /Tarde/ }).textContent).toContain("Vencida");
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

const OVERDUE_ROW = agendaRow({ id: "v1", appointmentAt: new Date("2026-09-16T13:30:00Z"), customerName: "Vieja", customerPhone: "7", vehiclePlate: null });

describe("AgendaPage Vencidas and combined", () => {
  beforeEach(() => {
    session.mockResolvedValue({ id: "a", role: "administrador" });
    agendaOverdue.mockResolvedValue({ rows: [OVERDUE_ROW], truncated: false, total: 1 });
  });

  it.each(["day", "week", "month", "combined"])("Tabs on every view: %s shows the Vencidas badge and, opened, the list with its full date", async (view) => {
    render(await AgendaPage(params({ view, date: "2026-10-26" })));

    expect(screen.getByRole("tab", { name: /Vencidas/ })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("tab", { name: /Vencidas/ }));
    expect(screen.getByText(/16\/09\/2026 08:30/)).toBeInTheDocument();
  });

  it.each(["day", "week", "month", "combined"])("Every Vencida stays actionable on %s: from the Vencidas tab, and from the grid after a card is selected", async (view) => {
    agendaRange.mockResolvedValue({ truncated: false, rows: [{ ...OVERDUE_ROW, id: "r1", appointmentAt: new Date("2026-10-26T15:00:00Z") }] });

    render(await AgendaPage(params({ view, date: "2026-10-26" })));

    expect(screen.queryByRole("button", { name: "Reprogramar" })).not.toBeInTheDocument();
    if (view !== "month") {
      await userEvent.click(screen.getByRole("button", { name: /Vieja/ }));
      expect(screen.getByRole("button", { name: "Reprogramar", hidden: true })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "No se presentó", hidden: true })).toBeInTheDocument();
    }
    // `hidden`: the open sheet marks the page behind it aria-hidden.
    fireEvent.click(screen.getByRole("tab", { name: /Vencidas/, hidden: true }));
    await userEvent.click(screen.getByRole("button", { name: /Vieja/, hidden: true }));
    expect(screen.getByRole("button", { name: "No se presentó", hidden: true })).toBeInTheDocument();
  });

  it("the shell gets the true Vencida total, not the rows it loaded", async () => {
    agendaOverdue.mockResolvedValue({ rows: [OVERDUE_ROW], truncated: true, total: 501 });
    expect(shellProps(await AgendaPage(params({ view: "day", date: "2026-10-26" })))?.overdueTotal).toBe(501);
  });

  it("reads the overdue list with orderScope(user) and the same now the chips use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
    try {
      render(await AgendaPage(params({ view: "day", date: "2026-10-26" })));

      const [scope, now] = agendaOverdue.mock.calls[0];
      expect(scope).toBe(SCOPE);
      expect(now.toISOString()).toBe("2026-10-26T20:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("combined: the selected day's range plus the in-workshop read, both scoped", async () => {
    agendaInWorkshop.mockResolvedValue({ truncated: false, rows: [workshopRow({ id: "w1", status: "on_hold", esperaMotivo: "repuesto", holdSinceAt: new Date("2026-10-26T18:00:00Z") })] });

    render(await AgendaPage(params({ view: "combined", date: "2026-10-26" })));

    expect(agendaInWorkshop).toHaveBeenCalledWith(SCOPE);
    const [, range] = agendaRange.mock.calls[0];
    expect(range.to.toISOString()).toBe("2026-10-27T05:00:00.000Z");
    expect(screen.getByRole("link", { name: /Taller/ }).textContent).toContain("Repuesto");
  });

  it.each(["day", "week", "month"])("%s does not run the in-workshop read", async (view) => {
    render(await AgendaPage(params({ view, date: "2026-10-26" })));

    expect(agendaInWorkshop).not.toHaveBeenCalled();
  });
});

describe("AgendaPage shell wiring", () => {
  beforeEach(() => {
    session.mockResolvedValue({ id: "a", role: "administrador" });
    agendaRange.mockResolvedValue({ truncated: false, rows: [agendaRow({ id: "o1", technicians: [{ id: "t1", nombre: "Julio Rangel" }] })] });
    agendaInWorkshop.mockResolvedValue({ truncated: false, rows: [workshopRow({ id: "w1" })] });
  });

  it.each(["day", "week", "combined"])("%s goes through the shell with plain props only", async (view) => {
    const props = shellProps(await AgendaPage(params({ view, date: "2026-10-26" })));
    expect(props).not.toBeNull();
    expect(props).toMatchObject({ view, date: "2026-10-26" });
    expect(() => assertPlain(props)).not.toThrow();
  });

  it("the plain-props check catches a function and a Date", () => {
    expect(() => assertPlain({ onSelect: () => {} })).toThrow("props.onSelect is a function");
    expect(() => assertPlain({ items: [{ at: new Date() }] })).toThrow("props.items[0].at is a Date");
  });

  it("now is captured once: the same instant decides Vencida, the Vencidas read and the now-line minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T20:00:00Z")); // 15:00 Panama
    try {
      const props = shellProps(await AgendaPage(params({ view: "day", date: "2026-10-26" })));
      expect(props).toMatchObject({ today: "2026-10-26", nowMinute: 15 * 60 });
      expect(agendaOverdue.mock.calls[0][1].toISOString()).toBe("2026-10-26T20:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Assign roster: a user who may assign gets the active roster as { id, nombre } only, plain props", async () => {
    const props = shellProps(await AgendaPage(params({ view: "week", date: "2026-10-26" })));
    expect(listTecnicos).toHaveBeenCalledTimes(1);
    expect(props?.roster).toEqual([
      { id: "t1", nombre: "Julio Rangel" },
      { id: "t2", nombre: "Marta Pérez" },
    ]);
    expect(() => assertPlain(props)).not.toThrow();
  });

  it("Assign control follows the permission: without service-orders.assign the roster is never read and the shell gets null", async () => {
    canMock.mockImplementation((_user: unknown, permission: string) => permission !== "service-orders.assign");
    const props = shellProps(await AgendaPage(params({ view: "week", date: "2026-10-26" })));
    expect(listTecnicos).not.toHaveBeenCalled();
    expect(props?.roster).toBeNull();
  });

  it("only the combined view hands the shell the workshop list", async () => {
    const day = shellProps(await AgendaPage(params({ view: "day", date: "2026-10-26" })));
    expect(day?.workshop).toBeNull();
    const combined = shellProps(await AgendaPage(params({ view: "combined", date: "2026-10-26" })));
    expect(combined?.workshop).toHaveLength(1);
    expect(combined?.workshopTruncated).toBe(false);
  });
});
