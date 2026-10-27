import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const queries = vi.hoisted(() => ({ workshopBoardData: vi.fn() }));
vi.mock("@/modules/board/queries", () => queries);

// The client board only records the props the page hands it: plain data, no functions or Dates.
const props = vi.hoisted(() => vi.fn());
vi.mock("@/modules/board/WorkshopBoard", () => ({
  WorkshopBoard: (p: unknown) => {
    props(p);
    return <div data-testid="workshop-board" />;
  },
}));

import BoardPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/tablero", () => {
  it("Pantalla is denied the full board: PermissionDenied, and the query seam is never called", async () => {
    session.mockResolvedValue({ id: "p", role: "pantalla" });

    render(await BoardPage());

    expect(screen.getByText("Volver al inicio")).toBeInTheDocument();
    expect(queries.workshopBoardData).not.toHaveBeenCalled();
    expect(screen.queryByTestId("workshop-board")).not.toBeInTheDocument();
  });

  it.each(["tecnico", "administrador", "jefe_taller"])("%s gets the board with a serializable snapshot and no control", async (role) => {
    session.mockResolvedValue({ id: "u", role });
    queries.workshopBoardData.mockResolvedValue({
      rows: [{ id: "x", status: "open", esperaMotivo: null, updatedAt: new Date("2026-10-26T14:00:00Z"), appointmentAt: null, plate: "AB1234", make: "Kia", model: "Rio" }],
      techs: [{ ordenId: "x", nombre: "Ana" }],
      since: [],
    });

    const { container } = render(await BoardPage());

    expect(screen.getByTestId("workshop-board")).toBeInTheDocument();
    expect(container.querySelector("button, form, a")).toBeNull();
    const { initial } = props.mock.calls[0][0];
    expect(initial.rows[0]).toMatchObject({ plate: "AB1234", technicians: ["Ana"], statusLabel: "Recibida" });
    expect(typeof initial.generatedAt).toBe("string");
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial);
  });
});
