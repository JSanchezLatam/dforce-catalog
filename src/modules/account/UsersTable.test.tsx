/**
 * Component tests for the admin user list. The behaviours that matter here are
 * the ones an admin can lock themselves out with: which rows are visible, which
 * action each row offers, and what happens when the safety guard refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { checkAdminSafety } from "./service";
import { UsersTable, type UserRow } from "./UsersTable";

/**
 * Every case below renders inside the REAL provider, not a fake: the toast is
 * a portal on `document.body`, which is exactly what `screen` queries, so a
 * success message can be asserted as rendered text rather than as a spy call.
 * A spy proves the function ran; it does not prove anything reached the
 * operator's screen.
 */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

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

type User = ReturnType<typeof userEvent.setup>;

/**
 * The row actions live in a kebab menu (table-redesign WU3). Two consequences
 * for every assertion below:
 *
 * - The menu content is PORTALED to `document.body`, so it is never inside the
 *   row. `within(rowFor(...))` cannot see it — the item is queried off
 *   `screen`, which is unambiguous because only one row's menu is ever open.
 * - The items are `role="menuitem"`, not `role="button"`. The kebab TRIGGER is
 *   the button, and it is named per row so two rows never collide.
 */
async function openRowMenu(user: User, username: string) {
  await user.click(screen.getByRole("button", { name: `Acciones de ${username}` }));
  // The popup mounts asynchronously; without this every subsequent query races it.
  await screen.findByRole("menu");
}

async function clickRowAction(user: User, username: string, action: string) {
  await openRowMenu(user, username);
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

/**
 * Cell `n` of every body row, in render order, where `n` counts the DATA
 * columns — Usuario is 0.
 *
 * The `+ 1` is the selection checkbox WU5 put in front of them. Absorbing it
 * here rather than at 15 call sites keeps every assertion below reading in
 * terms of the column an operator sees.
 */
function columnInOrder(index: number) {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[index + 1].textContent);
}

/** Body rows, in render order, read back through their first cell (Usuario). */
function usernamesInOrder() {
  return columnInOrder(0);
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
  //
  // WU3 (design D8) makes it a real `components/ui/badge.tsx` rather than the
  // bare text it used to be, so the assertion names the element and not only
  // the string — bare text would satisfy `getByText` forever.
  it("marks a deactivated row with a visible Inactivo badge", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("beto")).getByText("Inactivo")).toHaveAttribute("data-slot", "badge");
    expect(within(rowFor("ana")).queryByText("Inactivo")).not.toBeInTheDocument();
    // The active row is badged too — the column is an enum, not a marker that
    // only appears when something is wrong.
    expect(within(rowFor("ana")).getByText("Activo")).toHaveAttribute("data-slot", "badge");
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
  it("offers Desactivar on an active row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE]} />);

    await openRowMenu(user, "ana");

    expect(screen.getByRole("menuitem", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("offers Reactivar on a deactivated row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await openRowMenu(user, "beto");

    expect(screen.getByRole("menuitem", { name: "Reactivar" })).toBeInTheDocument();
  });

  it("offers Editar on an active row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE]} />);

    await openRowMenu(user, "ana");

    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  });

  // Reactivate first: editing a row whose state is "inactive" leaves it
  // ambiguous whether the save was supposed to bring the user back.
  it("does not offer Editar on a deactivated row", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await openRowMenu(user, "beto");

    // The positive half first: the menu really did open, so the absence below
    // is Editar missing rather than the query looking at nothing.
    expect(screen.getByRole("menuitem", { name: "Reactivar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
  });

  // One kebab per row, each named after that row's user: two rows on screen
  // and an ambiguous accessible name makes `getByRole` throw.
  it("names each row's kebab after that row's user", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    expect(within(rowFor("ana")).getByRole("button", { name: "Acciones de ana" })).toBeInTheDocument();
    expect(within(rowFor("beto")).getByRole("button", { name: "Acciones de beto" })).toBeInTheDocument();
  });

  it("sends active:false and refreshes on a successful deactivate", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { success: true } });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

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

    await clickRowAction(user, "beto", "Reactivar");

    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ active: true }));
  });

  it("opens the edit dialog from the kebab", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Editar");

    expect(await screen.findByRole("dialog")).toHaveTextContent("Editar usuario");
  });
});

/**
 * Every mutation on this table is answered by a `router.refresh()` that
 * re-renders a SERVER component, so until it lands the row is unchanged and
 * the kebab has already closed — the operator's only evidence that anything
 * happened was the row eventually redrawing itself.
 */
describe("UsersTable — a mutation the operator can see", () => {
  it("says the user was deactivated", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { success: true } });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

    expect(await screen.findByText("Usuario desactivado")).toBeInTheDocument();
  });

  it("says the user was reactivated", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { success: true } });
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await clickRowAction(user, "beto", "Reactivar");

    expect(await screen.findByText("Usuario reactivado")).toBeInTheDocument();
  });

  /**
   * The dialog this table hoists out of the kebab is edit-only — `editing` is
   * always an existing row — so there is no "creado" branch to get wrong here.
   */
  it("says the user was updated after the hoisted edit dialog saves", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 200, body: { user: { id: "u-1" } } });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Editar");
    await user.click(await screen.findByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Usuario actualizado")).toBeInTheDocument();
  });

  it("says nothing when the server refuses the toggle", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "last_active_admin" } });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

    await screen.findByRole("alert");
    expect(screen.queryByText("Usuario desactivado")).not.toBeInTheDocument();
  });
});

/**
 * ACTIVATION, not markup — the property unit 2 got wrong in a way that would
 * have shipped, and the reason these three tests exist at all.
 *
 * What was measured here, in jsdom against base-ui 1.6, before the component
 * was written (numbers are activations out of one keystroke pair):
 *
 * - `<DropdownMenuItem onClick>` — keyboard 1, mouse 1. The shape used.
 * - `<DropdownMenuItem render={<button onClick/>}>` — keyboard **0**. Note
 *   this is the OPPOSITE of unit 2's link, where `render` was the fix: for a
 *   button-like item base-ui's own item handler is what fires, and rendering a
 *   real `<button>` swaps it out for one Enter never reaches.
 * - `UserFormTrigger` nested inside a `DropdownMenuItem` — 0 dialogs by
 *   keyboard AND 0 by mouse, because selecting the item closes the menu and
 *   the dialog unmounts with it.
 * - `UserFormTrigger` as a plain child of the menu content — the dialog opens,
 *   but the MENU STAYS OPEN behind it (`data-open` still set) and its
 *   `useTypeahead` handler `preventDefault`s every printable keydown, so the
 *   dialog cannot be typed into. That is why the dialog is hoisted out of the
 *   menu entirely and the item only sets state. The last test below is what
 *   fails if anyone puts it back.
 */
describe("UsersTable — every kebab item is activatable from the keyboard", () => {
  it("ArrowDown then Enter activates Editar", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE]} />);
    await openRowMenu(user, "ana");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("dialog")).toHaveTextContent("Editar usuario");
  });

  it("ArrowUp then Enter activates Desactivar, the last item", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: {} });
    render(<UsersTable users={[ACTIVE]} />);
    await openRowMenu(user, "ana");

    await user.keyboard("{ArrowUp}{Enter}");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ active: false }));
  });

  // The dialog must be a sibling of the kebab, not a descendant of its menu.
  // React routes synthetic events along the REACT tree, not the DOM one, so a
  // dialog portaled from inside the menu still hands its keydowns to the menu's
  // typeahead, which swallows them. Nothing about the markup shows that.
  it("the dialog opened from the kebab still accepts typing", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE]} />);
    await clickRowAction(user, "ana", "Editar");
    await screen.findByRole("dialog");

    const nameField = screen.getByLabelText("Nombre");
    await user.clear(nameField);
    await user.type(nameField, "Ana Nueva");

    expect(nameField).toHaveValue("Ana Nueva");
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
      await clickRowAction(user, "ana", "Desactivar");

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

    await clickRowAction(user, "ana", "Desactivar");

    expect(await screen.findByRole("alert")).toHaveTextContent("último administrador");
    // The row must not optimistically flip — the server refused, so the user
    // is still active and the action still available to retry. Re-opened,
    // because selecting an item closes the menu.
    await openRowMenu(user, "ana");
    expect(screen.getByRole("menuitem", { name: "Desactivar" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("translates self_deactivate rather than echoing the raw code", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { error: "self_deactivate" } });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("tu propia cuenta");
    expect(alert).not.toHaveTextContent("self_deactivate");
  });

  it("falls back to a readable message for an unrecognised code", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 500, body: {} });
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo");
  });

  it("recovers from a rejected fetch instead of leaving the button disabled", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<UsersTable users={[ACTIVE]} />);

    await clickRowAction(user, "ana", "Desactivar");

    // The FULL sentence, not a prefix: `CONNECTION_ERROR` is shared by six
    // surfaces now, and a substring match lets its tail be rewritten with
    // this file still green.
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    // `aria-disabled`, not `toBeEnabled()`: a `DropdownMenuItem` is a div, and
    // `toBeDisabled` only reads the `disabled` ATTRIBUTE, so it passes on any
    // div forever and would prove nothing.
    await openRowMenu(user, "ana");
    expect(screen.getByRole("menuitem", { name: "Desactivar" })).not.toHaveAttribute("aria-disabled", "true");
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

/**
 * table-redesign WU5 — bulk activate/deactivate, and the admin-floor invariant
 * that makes SEQUENCING a safety property rather than a politeness (design D2,
 * `user-management` delta).
 *
 * **The fake API below is stateful on purpose, and that is the whole test.**
 * A `fetch` that always answers 200 cannot tell a sequential loop apart from a
 * concurrent one, so a test written against one is a placebo. This one models
 * the two things that turn the admin floor into a RACE:
 *
 * 1. `deactivateUser()` re-reads the active-administrador set INSIDE its own
 *    transaction, per call (`account/service.ts:468-475`);
 * 2. under `read committed` there is a window between that read and the
 *    COMMIT — `await Promise.resolve()` below IS that window. Without it the
 *    fake would commit synchronously, `Promise.all` at the call site would
 *    still serialise the check, and the 5.6 mutation would pass green.
 *
 * The decision itself is the REAL `checkAdminSafety`, imported rather than
 * reimplemented: a hand-rolled copy of the two rules would drift from the one
 * the route actually enforces.
 */
describe("UsersTable — bulk activate/deactivate (WU5)", () => {
  function json(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  type FakeUser = { id: string; role: string; active: boolean };

  /**
   * `actorId` is the session identity the route reads, NOT anything the client
   * sends — the client never learns who it is, which is precisely why the
   * per-row refusal has to come back from the server.
   */
  function fakeUsersApi(actorId: string, table: readonly FakeUser[]) {
    const rows = new Map(table.map((u) => [u.id, { ...u }]));
    const activeAdminIds = () =>
      [...rows.values()].filter((u) => u.role === "administrador" && u.active).map((u) => u.id);

    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      const id = url.slice(url.lastIndexOf("/") + 1);
      const { active } = JSON.parse(init.body) as { active: boolean };
      const row = rows.get(id);
      if (!row) return json(404, { error: "not_found" });

      if (active) {
        // `reactivateUser()` never calls `checkAdminSafety` — raising the
        // count can never violate the floor, so there is no transaction here.
        row.active = true;
        return json(200, { success: true });
      }

      // TX BEGINS — the precondition read.
      const admins = activeAdminIds();
      // …and the window between that read and the COMMIT below.
      await Promise.resolve();
      const violation = checkAdminSafety({
        actorId,
        targetId: id,
        operation: "deactivate",
        activeAdminIds: admins,
      });
      if (violation) return json(400, { error: violation });
      row.active = false; // COMMIT
      return json(200, { success: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, activeAdminIds, rows };
  }

  /** `PATCH /api/users/<id>` bodies, in the order the runner issued them. */
  function patchesInOrder(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.map(([url, init]) => ({
      id: String(url).slice(String(url).lastIndexOf("/") + 1),
      ...(JSON.parse((init as { body: string }).body) as { active: boolean }),
    }));
  }

  const admin = (id: string, username: string, active = true): UserRow => ({
    id,
    username,
    name: null,
    email: null,
    role: "administrador",
    deactivatedAt: active ? null : "2026-01-01T00:00:00.000Z",
  });
  const tech = (id: string, username: string, active = true): UserRow => ({
    ...admin(id, username, active),
    role: "tecnico",
  });

  async function select(user: User, ...usernames: string[]) {
    for (const username of usernames) {
      await user.click(screen.getByRole("checkbox", { name: `Seleccionar ${username}` }));
    }
  }

  /** The result panel, which is the second `role="status"` region on screen. */
  function resultPanel() {
    return screen.getByText(/Se aplic/).closest("[role='status']") as HTMLElement;
  }

  /**
   * The user-management spec is explicit that a mixed selection must never be
   * resolved by one button guessing per row: "Activar" and "Desactivar" are
   * two always-available actions.
   */
  it("offers Activar and Desactivar as two separate, always-available actions", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={[ACTIVE, INACTIVE]} />);
    await user.click(screen.getByLabelText("Mostrar inactivos"));

    await select(user, "ana", "beto");

    expect(screen.getByRole("button", { name: "Activar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeEnabled();
    // Neither is a per-row inference wearing a bulk label.
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
  });

  /**
   * THE binding safety property. Two active administrators, both selected: one
   * deactivation lands, the second is refused with `last_active_admin`, and the
   * workshop is left with an administrator.
   *
   * The acting admin is deliberately NOT one of the two. `checkAdminSafety`
   * refuses a self-deactivation before it ever reaches the floor rule, so an
   * actor inside the selection would exercise rule 1 and never rule 2 — the
   * scenario would look green while testing nothing about the count.
   *
   * Asserted against the injected `fetch` (call order and count) as well as
   * the panel: a panel-only assertion cannot tell one refused PATCH apart from
   * one that was never issued.
   */
  it("deactivates exactly one of the last two administrators and refuses the other", async () => {
    const user = userEvent.setup();
    const { fetchMock, activeAdminIds } = fakeUsersApi("u-otro", [
      { id: "u-1", role: "administrador", active: true },
      { id: "u-2", role: "administrador", active: true },
    ]);

    render(<UsersTable users={[admin("u-1", "ana"), admin("u-2", "beto")]} />);
    await select(user, "ana", "beto");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    // One request per row, in selection order — never a batched read.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(patchesInOrder(fetchMock)).toEqual([
      { id: "u-1", active: false },
      { id: "u-2", active: false },
    ]);

    // The invariant itself, read off the fake server rather than off the UI.
    expect(activeAdminIds()).toEqual(["u-2"]);

    const panel = await screen.findByText("No se puede desactivar al último administrador activo.", {
      exact: false,
    });
    expect(panel).toBeInTheDocument();
    expect(within(resultPanel()).getByText("beto")).toBeInTheDocument();
    expect(resultPanel()).toHaveTextContent("Se aplicó 1 fila");
  });

  /**
   * Self-inclusion is refused per row, not for the whole batch
   * (`user-management` spec Scenario).
   */
  it("processes the other rows and refuses the actor's own account", async () => {
    const user = userEvent.setup();
    const { fetchMock, rows } = fakeUsersApi("u-1", [
      { id: "u-1", role: "administrador", active: true },
      { id: "u-2", role: "tecnico", active: true },
      { id: "u-3", role: "tecnico", active: true },
      { id: "u-4", role: "tecnico", active: true },
      { id: "u-5", role: "tecnico", active: true },
    ]);

    render(
      <UsersTable
        users={[
          admin("u-1", "ana"),
          tech("u-2", "beto"),
          tech("u-3", "caro"),
          tech("u-4", "dani"),
          tech("u-5", "elo"),
        ]}
      />,
    );
    await select(user, "ana", "beto", "caro", "dani", "elo");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(resultPanel()).toHaveTextContent("Se aplicaron 4 filas");
    expect(within(resultPanel()).getByText("ana")).toBeInTheDocument();
    expect(
      within(resultPanel()).getByText(/No puedes desactivar tu propia cuenta/),
    ).toBeInTheDocument();
    // The other four really did apply — a batch that aborted on the refusal
    // would also show one failure.
    expect([...rows.values()].filter((r) => r.active).map((r) => r.id)).toEqual(["u-1"]);
  });

  /**
   * A mixed selection: "Desactivar" leaves the already-inactive row a no-op
   * success, never a reported failure (`user-management` spec Scenario). The
   * client cannot know which rows are already inactive — it must issue the
   * PATCH for every selected row and let the server answer.
   */
  it("reports an already-inactive row as a no-op, not a failure", async () => {
    const user = userEvent.setup();
    const { fetchMock } = fakeUsersApi("u-otro", [
      { id: "u-1", role: "administrador", active: true },
      { id: "u-2", role: "tecnico", active: true },
      { id: "u-3", role: "tecnico", active: false },
    ]);

    render(
      <UsersTable users={[admin("u-1", "ana"), tech("u-2", "beto"), tech("u-3", "caro", false)]} />,
    );
    await user.click(screen.getByLabelText("Mostrar inactivos"));
    await select(user, "beto", "caro");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // The already-inactive row was still sent, not silently dropped.
    expect(patchesInOrder(fetchMock)).toEqual([
      { id: "u-2", active: false },
      { id: "u-3", active: false },
    ]);
    expect(resultPanel()).toHaveTextContent("Se aplicaron 2 filas");
    expect(within(resultPanel()).queryByRole("listitem")).not.toBeInTheDocument();
  });
});
