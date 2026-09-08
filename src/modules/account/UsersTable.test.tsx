/**
 * Component tests for the admin user list. The behaviours that matter here are
 * the ones an admin can lock themselves out with: which rows are visible, which
 * action each row offers, and what happens when the safety guard refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UsersTable, type UserRow } from "./UsersTable";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * `ROLE_LABELS` is kept REAL here — `importOriginal` copies the shipped map in,
 * so every test below renders the real Spanish labels and the component still
 * has to read the shared constant rather than a local duplicate.
 *
 * The one exception is the role-sorting test. The real map's two entries order
 * identically to their keys ("Administrador" < "Técnico" and "administrador" <
 * "tecnico"), so against it a label sort and a raw-key sort are
 * indistinguishable and a role-sorting assertion is a placebo. That test
 * temporarily swaps in labels whose order is the REVERSE of their keys, then
 * restores them — a fixture deliberately LESS convenient than reality, and the
 * only shape in which the "sorts by the label shown" seam is observable.
 */
const roleLabels = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock("@/modules/auth/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/auth/roles")>();
  Object.assign(roleLabels, actual.ROLE_LABELS);
  return { ...actual, ROLE_LABELS: roleLabels };
});

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

/** Body rows, in render order, read back through their first cell (Usuario). */
function usernamesInOrder() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

/** Cell `n` of every body row, in render order. */
function columnInOrder(index: number) {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[index].textContent);
}

function activeUser(overrides: Partial<UserRow> & { id: string; username: string }): UserRow {
  return { ...ACTIVE, name: null, email: null, deactivatedAt: null, ...overrides };
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

/**
 * Nothing in `src/` asserted either role label before this block existed —
 * `crm-shell-settings-rbac/verify-report.md:62` recorded exactly that, and it
 * is why the two same-named `ROLE_LABELS` constants were free to disagree on
 * screen for months. The value below is the one the app settled on; the
 * archived `role-permissions/spec.md:11` says "Técnico de taller", and this
 * change amends it deliberately rather than by drift.
 */
describe("UsersTable — the role label it renders", () => {
  it("renders the Spanish role label from the shared constant, not a raw enum value", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("ana")).getByText("Administrador")).toBeInTheDocument();
    expect(within(rowFor("beto")).getByText("Técnico")).toBeInTheDocument();
    expect(screen.queryByText("tecnico")).not.toBeInTheDocument();
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

/**
 * table-column-sorting WU4 — this table sorts CLIENT-SIDE over the array the
 * page already handed it (a workshop has a handful of users, same reasoning as
 * the `Mostrar inactivos` filter above), so the headers are `<button>`s and no
 * request leaves the browser.
 */
describe("UsersTable — column sorting", () => {
  it("re-orders the visible rows on a header click without touching the network", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200 });
    render(
      <UsersTable
        users={[
          activeUser({ id: "s-1", username: "zoe" }),
          activeUser({ id: "s-2", username: "ana" }),
        ]}
      />,
    );
    expect(usernamesInOrder()).toEqual(["zoe", "ana"]);

    await user.click(screen.getByRole("button", { name: "Usuario" }));

    expect(usernamesInOrder()).toEqual(["ana", "zoe"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toggles the same column to descending and marks it with aria-sort", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        users={[
          activeUser({ id: "s-1", username: "zoe" }),
          activeUser({ id: "s-2", username: "ana" }),
        ]}
      />,
    );

    const header = screen.getByRole("button", { name: "Usuario" });
    await user.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
    // No other column claims a direction while Usuario is the active one.
    expect(screen.getByRole("button", { name: "Rol" }).closest("th")).not.toHaveAttribute("aria-sort");

    await user.click(header);

    expect(usernamesInOrder()).toEqual(["zoe", "ana"]);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  // A plain `<` puts "Bruno" first: `Á` is U+00C1, above `B` in code-point
  // order. Only a locale-aware comparison reads it as an accented `A`.
  it("sorts 'Ángela' before 'Bruno' by name, which a code-point compare does not", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        users={[
          activeUser({ id: "s-1", username: "bruno", name: "Bruno Paz" }),
          activeUser({ id: "s-2", username: "angela", name: "Ángela Sosa" }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nombre" }));

    expect(columnInOrder(1)).toEqual(["Ángela Sosa", "Bruno Paz"]);
    expect(usernamesInOrder()).toEqual(["angela", "bruno"]);
  });

  it("sorts the Rol column by the label it renders, not by the raw role key", async () => {
    const user = userEvent.setup();
    const real = { ...roleLabels };
    // Reverse of the key order: "administrador" < "tecnico", but "Zulú" >
    // "Alfa". A sort over the raw keys leaves ana first and fails here.
    Object.assign(roleLabels, { administrador: "Zulú", tecnico: "Alfa" });
    try {
      render(
        <UsersTable
          users={[
            activeUser({ id: "s-1", username: "ana", role: "administrador" }),
            activeUser({ id: "s-2", username: "beto", role: "tecnico" }),
          ]}
        />,
      );
      // The rendered label comes from the shared constant, not a local copy.
      expect(columnInOrder(3)).toEqual(["Zulú", "Alfa"]);

      await user.click(screen.getByRole("button", { name: "Rol" }));

      expect(columnInOrder(3)).toEqual(["Alfa", "Zulú"]);
      expect(usernamesInOrder()).toEqual(["beto", "ana"]);
    } finally {
      Object.assign(roleLabels, real);
    }
  });

  // The spec's NULL Ordering requirement names users' `name` and `email`: a
  // row with no value sorts LAST in BOTH directions, never first. A plain
  // comparator gets this wrong for free — `"".localeCompare(x)` is negative,
  // so the empty string leads ascending, and negating it for `desc` only moves
  // the problem to the other end.
  it("sorts the Email column with the missing email last, ascending AND descending", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        users={[
          activeUser({ id: "s-1", username: "zoe", email: "zoe@taller.com" }),
          activeUser({ id: "s-2", username: "ana", email: "ana@taller.com" }),
          activeUser({ id: "s-3", username: "nadie", email: null }),
        ]}
      />,
    );

    const header = screen.getByRole("button", { name: "Email" });
    await user.click(header);
    expect(usernamesInOrder()).toEqual(["ana", "zoe", "nadie"]);

    await user.click(header);

    expect(usernamesInOrder()).toEqual(["zoe", "ana", "nadie"]);
  });

  it("sorts the Nombre column with the missing name last, ascending AND descending", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        users={[
          activeUser({ id: "s-1", username: "zoe", name: "Zoe Paz" }),
          activeUser({ id: "s-2", username: "nadie", name: null }),
          activeUser({ id: "s-3", username: "ana", name: "Ana Sosa" }),
        ]}
      />,
    );

    const header = screen.getByRole("button", { name: "Nombre" });
    await user.click(header);
    expect(usernamesInOrder()).toEqual(["ana", "zoe", "nadie"]);

    await user.click(header);

    expect(usernamesInOrder()).toEqual(["zoe", "ana", "nadie"]);
  });

  // The one non-string comparator: `estado` is derived from `deactivatedAt`,
  // and ascending has to mean Activo first — the reverse reads as backwards
  // against the "Activo"/"Inactivo" labels the column actually shows.
  it("sorts the Estado column with the active rows first", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[INACTIVE, ACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));
    expect(usernamesInOrder()).toEqual(["beto", "ana"]);

    await user.click(screen.getByRole("button", { name: "Estado" }));

    expect(usernamesInOrder()).toEqual(["ana", "beto"]);
    expect(columnInOrder(4)).toEqual(["Activo", "Inactivo"]);
  });

  it("offers no sort control on Acciones", () => {
    render(<UsersTable users={[ACTIVE]} />);

    const acciones = screen.getByRole("columnheader", { name: "Acciones" });
    expect(acciones).toBeInTheDocument();
    expect(within(acciones).queryByRole("button")).not.toBeInTheDocument();
    // The positive half — every other header IS a control, so the assertion
    // above cannot pass merely because no header is clickable.
    for (const name of ["Usuario", "Nombre", "Email", "Rol", "Estado"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
