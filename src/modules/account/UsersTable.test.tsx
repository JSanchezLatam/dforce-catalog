/**
 * Component tests for the admin user list. The behaviours that matter here are
 * the ones an admin can lock themselves out with: which rows are visible, which
 * action each row offers, and what happens when the safety guard refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UsersTable } from "./UsersTable";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ACTIVE = {
  id: "u-1",
  username: "ana",
  name: "Ana Ruiz",
  email: "ana@taller.com",
  role: "administrador",
  deactivatedAt: null,
};
const INACTIVE = {
  id: "u-2",
  username: "beto",
  name: "Beto Díaz",
  email: null,
  role: "tecnico",
  deactivatedAt: "2026-01-01T00:00:00.000Z",
};

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rowFor(username: string) {
  return screen.getByRole("row", { name: new RegExp(username) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("UsersTable — which rows are visible", () => {
  it("hides deactivated users until asked", () => {
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);

    expect(screen.getByText("ana")).toBeInTheDocument();
    expect(screen.queryByText("beto")).not.toBeInTheDocument();
  });

  it("reveals them when 'Mostrar inactivos' is switched on", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);

    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(screen.getByText("beto")).toBeInTheDocument();
  });

  it("hides them again when switched back off", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    const toggle = screen.getByLabelText("Mostrar inactivos");

    await user.click(toggle);
    await user.click(toggle);

    expect(screen.queryByText("beto")).not.toBeInTheDocument();
  });

  // A text badge, not colour alone: colour is not an accessible signal and a
  // greyed row reads identically to an active one in a screen reader.
  it("marks a deactivated row with a visible Inactivo badge", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("beto")).getByText("Inactivo")).toBeInTheDocument();
    expect(within(rowFor("ana")).queryByText("Inactivo")).not.toBeInTheDocument();
  });
});

describe("UsersTable — the action each row offers", () => {
  it("offers Desactivar on an active row", () => {
    render(<UsersTable users={[ACTIVE]} />);

    expect(within(rowFor("ana")).getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("offers Reactivar on a deactivated row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("beto")).getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
  });

  it("offers Editar on an active row", () => {
    render(<UsersTable users={[ACTIVE]} />);

    expect(within(rowFor("ana")).getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  // Reactivate first: editing a row whose state is "inactive" leaves it
  // ambiguous whether the save was supposed to bring the user back.
  it("does not offer Editar on a deactivated row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("beto")).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("sends active:false and refreshes on a successful deactivate", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UsersTable users={[ACTIVE]} />);

    await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/users/u-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sends active:true on a reactivate", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await user.click(within(rowFor("beto")).getByRole("button", { name: "Reactivar" }));

    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ active: true }));
  });
});

/**
 * `router.refresh()` runs OUTSIDE the `try` that catches the fetch, so a
 * refresh that throws is never reported as a connection failure over a
 * deactivation the server already applied. Nothing pinned that: widening the
 * `try` to cover it left this whole file green.
 */
describe("UsersTable — a throwing refresh is not a connection failure", () => {
  it("does not show the connection error when the refresh itself throws", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: {} });
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw ESCAPES — that is the property under test — so it surfaces as
    // an unhandled rejection. Captured rather than left for the runner: a
    // stray one is silent under this config and a red suite under a stricter
    // one (`customers/service.test.ts` documents the same trap). Capturing it
    // also makes "no connection error appeared" a positive claim: the error
    // went somewhere, and that somewhere was not the operator's screen.
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<UsersTable users={[ACTIVE]} />);
      await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).not.toBeInTheDocument();
  });
});

describe("UsersTable — when the safety guard refuses", () => {
  it("surfaces last_active_admin inline and leaves the row active", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "last_active_admin" } });
    render(<UsersTable users={[ACTIVE]} />);

    await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("último administrador");
    // The row must not optimistically flip — the server refused, so the user
    // is still active and the action still available to retry.
    expect(within(rowFor("ana")).getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("translates self_deactivate rather than echoing the raw code", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "self_deactivate" } });
    render(<UsersTable users={[ACTIVE]} />);

    await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("tu propia cuenta");
    expect(alert).not.toHaveTextContent("self_deactivate");
  });

  it("falls back to a readable message for an unrecognised code", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 500, body: {} });
    render(<UsersTable users={[ACTIVE]} />);

    await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo");
  });

  it("recovers from a rejected fetch instead of leaving the button disabled", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<UsersTable users={[ACTIVE]} />);

    await user.click(within(rowFor("ana")).getByRole("button", { name: "Desactivar" }));

    // The FULL sentence, not a prefix: `CONNECTION_ERROR` is shared by six
    // surfaces now, and a substring match lets its tail be rewritten with
    // this file still green.
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    expect(within(rowFor("ana")).getByRole("button", { name: "Desactivar" })).toBeEnabled();
  });
});
