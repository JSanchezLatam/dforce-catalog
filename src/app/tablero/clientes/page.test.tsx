import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const queries = vi.hoisted(() => ({ customerBoardOrders: vi.fn() }));
vi.mock("@/modules/board/queries", () => queries);

// The client board only records the props the page hands it: plain data, no functions or Dates.
const props = vi.hoisted(() => vi.fn());
vi.mock("@/modules/board/CustomerBoard", () => ({
  CustomerBoard: (p: unknown) => {
    props(p);
    return <div data-testid="customer-board" />;
  },
}));

import CustomerBoardPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/tablero/clientes", () => {
  it("renders PermissionDenied for a técnico and never calls the query", async () => {
    session.mockResolvedValue({ id: "t", role: "tecnico" });

    render(await CustomerBoardPage());

    expect(screen.getByText("Volver al inicio")).toBeInTheDocument();
    expect(queries.customerBoardOrders).not.toHaveBeenCalled();
    expect(screen.queryByTestId("customer-board")).not.toBeInTheDocument();
  });

  it.each(["pantalla", "administrador", "jefe_taller"])("%s gets the board with a serializable snapshot", async (role) => {
    session.mockResolvedValue({ id: "u", role });
    queries.customerBoardOrders.mockResolvedValue([
      { id: "x", status: "open", esperaMotivo: null, updatedAt: new Date(), appointmentAt: null, plate: "AB1234", make: "Kia", model: "Rio" },
    ]);

    render(await CustomerBoardPage());

    expect(screen.getByTestId("customer-board")).toBeInTheDocument();
    const { initial } = props.mock.calls[0][0];
    expect(initial.rows).toEqual([{ plate: "AB1234", make: "Kia", model: "Rio", status: "Recibida" }]);
    expect(typeof initial.generatedAt).toBe("string");
    // structuredClone throws on a function and keeps a Date: the JSON round trip is the RSC wire.
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial);
  });
});
