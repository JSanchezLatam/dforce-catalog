import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
const kanbanData = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));
vi.mock("@/modules/kanban/queries", () => ({ kanbanData }));

// The client board only records the props the page hands it.
const boardProps = vi.hoisted(() => vi.fn());
vi.mock("@/modules/kanban/KanbanBoard", () => ({
  KanbanBoard: (p: unknown) => {
    boardProps(p);
    return <div data-testid="kanban-board" />;
  },
}));

import KanbanPage from "./page";

/**
 * The RSC trap: whatever the page hands a client component must serialize. jsdom renders a function or a
 * Date happily and Next refuses, so walk the props and reject anything but plain data.
 */
function assertPlain(value: unknown, path = "props"): void {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (typeof value === "function") throw new Error(`${path} is a function`);
  if (Array.isArray(value)) return value.forEach((v, i) => assertPlain(v, `${path}[${i}]`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype) throw new Error(`${path} is a ${proto?.constructor?.name ?? "non-plain object"}`);
  for (const [k, v] of Object.entries(value as object)) assertPlain(v, `${path}.${k}`);
}

// What kanbanData resolves: the raw query rows (Dates included) and the viewer's assignments.
const DATA = {
  rows: [
    {
      id: "ord-1", status: "in_progress", esperaMotivo: null, updatedAt: new Date("2026-10-26T14:00:00Z"), appointmentAt: null,
      urgenteAt: new Date("2026-10-26T14:30:00Z"), vehiculoId: "veh-1", categoria: "instalacion", plate: "AB1234", make: "Kia", model: "Rio",
    },
  ],
  techs: [{ ordenId: "ord-1", nombre: "Ana" }],
  since: [],
  viewer: { onRoster: true, ordenIds: ["ord-1"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T15:00:00Z") });
  kanbanData.mockResolvedValue(DATA);
});
afterEach(() => vi.useRealTimers());

describe("/kanban", () => {
  it("Pantalla is refused with PermissionDenied and nothing is queried", async () => {
    session.mockResolvedValue({ id: "p", role: "pantalla" });

    render(await KanbanPage());

    expect(screen.getByText("Volver al inicio")).toBeInTheDocument();
    expect(kanbanData).not.toHaveBeenCalled();
    expect(screen.queryByTestId("kanban-board")).not.toBeInTheDocument();
  });

  it.each([
    ["administrador", true],
    ["jefe_taller", true],
    ["tecnico", false],
  ])("%s gets the board with canMove=%s and plain props only", async (role, canMove) => {
    session.mockResolvedValue({ id: "u1", role });

    render(await KanbanPage());

    expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    const props = boardProps.mock.calls[0][0];
    expect(props.canMove).toBe(canMove);
    expect(() => assertPlain(props)).not.toThrow();
  });

  it("reads for the viewer at one instant, and the snapshot carries id, mine and the roster flag", async () => {
    session.mockResolvedValue({ id: "u1", role: "jefe_taller" });

    render(await KanbanPage());

    expect(kanbanData).toHaveBeenCalledWith("u1", new Date("2026-10-26T15:00:00Z"));
    const { initial } = boardProps.mock.calls[0][0];
    expect(initial.generatedAt).toBe("2026-10-26T15:00:00.000Z");
    expect(initial.onRoster).toBe(true);
    expect(initial.rows[0]).toMatchObject({ id: "ord-1", mine: true, urgent: true, missing: [], technicians: ["Ana"], statusSince: "2026-10-26T14:00:00.000Z" });
  });

  it("the plain-props check catches a function and a Date", () => {
    vi.useRealTimers(); // the fake clock's Date class has another name
    expect(() => assertPlain({ onSelect: () => {} })).toThrow("props.onSelect is a function");
    expect(() => assertPlain({ initial: { rows: [{ at: new Date() }] } })).toThrow("props.initial.rows[0].at is a Date");
  });
});
