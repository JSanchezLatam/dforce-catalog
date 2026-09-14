/**
 * Mirrors `CustomerBulkActions.test.tsx`. `UsersTable.test.tsx` already covers
 * this component in situ for the safety property that matters (the last active
 * administrator); what is pinned here is the other end — a run where every row
 * applied used to clear the selection, refresh and say nothing at all.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowCheckbox } from "@/shared/ui/selection/RowCheckbox";
import { SelectionProvider } from "@/shared/ui/selection/SelectionProvider";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { UserBulkActions } from "./UserBulkActions";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** A fake `/api/users/[id]`: every id applies except the ones named in `refuse`. */
function mockFetch(refuse: readonly string[] = []) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.slice(url.lastIndexOf("/") + 1);
    return refuse.includes(id)
      ? { ok: false, status: 400, json: async () => ({ error: "last_active_admin" }) }
      : { ok: true, status: 200, json: async () => ({ success: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The real ToastProvider, not a fake: it portals into `document.body`, which is what `screen` queries. */
function renderActions(ids: readonly string[]) {
  return render(
    <ToastProvider>
      <SelectionProvider
        pageIds={[...ids]}
        labels={Object.fromEntries(ids.map((id) => [id, id]))}
        filterKey="none"
      >
        {ids.map((id) => (
          <RowCheckbox key={id} id={id} label={id} />
        ))}
        <UserBulkActions />
      </SelectionProvider>
    </ToastProvider>,
  );
}

async function select(user: ReturnType<typeof userEvent.setup>, ...ids: string[]) {
  for (const id of ids) {
    await user.click(screen.getByRole("checkbox", { name: `Seleccionar ${id}` }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("UserBulkActions — a finished run has to say what it did", () => {
  it("reports how many users were deactivated", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderActions(["u-1", "u-2"]);

    await select(user, "u-1", "u-2");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByText("2 usuarios desactivados")).toBeInTheDocument();
  });

  it("keeps the count in the singular when exactly one row applied", async () => {
    const user = userEvent.setup();
    // Two selected, one refused — the count comes off the OUTCOMES, not the
    // selection, and "1 usuarios desactivados" is wrong in Spanish.
    mockFetch(["u-2"]);
    renderActions(["u-1", "u-2"]);

    await select(user, "u-1", "u-2");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByText("1 usuario desactivado")).toBeInTheDocument();
  });

  it("reports a reactivation as a reactivation", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderActions(["u-1", "u-2"]);

    await select(user, "u-1", "u-2");
    await user.click(screen.getByRole("button", { name: "Activar" }));

    expect(await screen.findByText("2 usuarios reactivados")).toBeInTheDocument();
  });

  /** Nothing applied — the result panel already names the rows that failed. */
  it("says nothing when no row applied", async () => {
    const user = userEvent.setup();
    mockFetch(["u-1"]);
    renderActions(["u-1"]);

    await select(user, "u-1");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/usuarios? desactivados?/)).not.toBeInTheDocument();
  });
});
