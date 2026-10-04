/**
 * /vencimientos. A page test invokes the page as a plain function, so it cannot
 * see an RSC serialisation problem — that is the browser check. What it CAN pin
 * is the allowlist: `DueVencimiento` carries server-only fields, and the client
 * button must receive the item's identity and nothing else.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "administrador" })),
}));
const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));

const getDueVencimientos = vi.hoisted(() => vi.fn());
vi.mock("@/modules/vencimientos/service", () => ({ getDueVencimientos }));

// Echoes its props verbatim, so a test can assert exactly what crossed the boundary.
vi.mock("@/modules/vencimientos/ContactadoButton", () => ({
  ContactadoButton: (props: Record<string, unknown>) => <div data-testid="contactado" data-props={JSON.stringify(props)} />,
}));

import VencimientosPage from "./page";

/** The `DueVencimiento` wire shape of service.ts, server-only fields included. */
function due(overrides: Record<string, unknown> = {}) {
  return {
    kind: "placa",
    periodKey: "2026-10",
    state: "due",
    daysLeft: null,
    vehiculoId: "v1",
    clienteId: "c1",
    customerName: "Transportes Chiriquí S.A.",
    customerPhone: "6230-8874",
    whatsappOptOut: false,
    make: "Nissan",
    model: "Frontier",
    plate: "BF0921",
    numeroUnidad: "U-12",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T15:00:00Z"));
  can.mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  getDueVencimientos.mockReset();
});

async function renderPage(rows: unknown[]) {
  getDueVencimientos.mockResolvedValue({ rows, count: rows.length });
  render(await VencimientosPage());
}

describe("/vencimientos — access", () => {
  it("refuses a viewer without vencimientos.read and never reads the due list", async () => {
    can.mockImplementation((_u, action) => action !== "vencimientos.read");
    render(await VencimientosPage());

    expect(screen.getByText("No tenés permiso para ver esta página.")).toBeInTheDocument();
    expect(getDueVencimientos).not.toHaveBeenCalled();
  });
});

describe("/vencimientos — list", () => {
  const rows = [
    due({ kind: "seguro", periodKey: "2026-09-28", state: "overdue", daysLeft: -6, vehiculoId: "v2", customerName: "María Quintero", customerPhone: "6612-4589", plate: "AB1234", make: "Toyota", model: "Hilux", numeroUnidad: null }),
    due(),
    due({ kind: "placa", periodKey: "2026-11", vehiculoId: "v3", customerName: "Luis Rodríguez", customerPhone: "6503-9216", plate: "DA4410", make: "Toyota", model: "Corolla", numeroUnidad: null }),
  ];

  it("shows customer, phone, plate, vehicle, what is due and its state, in the order the service gave", async () => {
    await renderPage(rows);
    const table = within(screen.getByTestId("vencimientos-table"));

    const bodyRows = table.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(within(bodyRows[0]).getByText("María Quintero")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("6612-4589")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("AB1234")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("Toyota Hilux")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("Seguro — venció 28/09/2026")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("Vencido")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("Placa — octubre")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("Este mes")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("· U-12")).toBeInTheDocument();
    expect(within(bodyRows[2]).getByText("Próximo mes")).toBeInTheDocument();
  });

  it("renders the same items as phone cards, so the table is not the only layout", async () => {
    await renderPage(rows);
    const cards = within(screen.getByTestId("vencimientos-cards"));

    expect(cards.getAllByRole("listitem")).toHaveLength(3);
    expect(cards.getByText("Transportes Chiriquí S.A.")).toBeInTheDocument();
    expect(cards.getByText("Placa — octubre")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is due", async () => {
    await renderPage([]);

    expect(screen.getByText("Nada por vencer")).toBeInTheDocument();
    expect(screen.getByText("No hay placas ni seguros por vencer en los próximos 30 días.")).toBeInTheDocument();
    expect(screen.queryByTestId("vencimientos-table")).not.toBeInTheDocument();
  });
});

describe("/vencimientos — what crosses into the client", () => {
  it("passes the button only the item's identity, never the opt-out flag, the client id or the phone", async () => {
    await renderPage([due({ whatsappOptOut: true, clienteId: "SENTINEL-CLIENTE-ID", customerPhone: "SENTINEL-PHONE" })]);

    const rendered = screen.getAllByTestId("contactado");
    expect(rendered.length).toBeGreaterThan(0);
    for (const el of rendered) {
      expect(JSON.parse(el.getAttribute("data-props") ?? "")).toEqual({ vehiculoId: "v1", kind: "placa", periodKey: "2026-10" });
    }
    expect(document.body.innerHTML).not.toContain("SENTINEL-CLIENTE-ID");
    expect(document.body.innerHTML).not.toContain("whatsappOptOut");
  });
});
