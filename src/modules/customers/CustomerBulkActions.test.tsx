/**
 * The bulk half of `/customers`. `BulkResultPanel` already names the rows that
 * FAILED, so the gap these tests pin is the opposite one: a run where every
 * row applied cleared the selection, refreshed the page and said nothing at
 * all — on a list whose rows are server-rendered, the operator's only evidence
 * was that the ticks disappeared.
 *
 * The count is read off the outcomes, so it has to survive a partial run, and
 * it has to agree with itself in Spanish: "1 clientes desactivados" is wrong.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RowCheckbox } from "@/shared/ui/selection/RowCheckbox";
import { SelectionProvider } from "@/shared/ui/selection/SelectionProvider";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { CustomerBulkActions } from "./CustomerBulkActions";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * A fake `/api/customers/[id]`: every id applies except the ones named in
 * `refuse`, which answer the way the real route answers a row another session
 * already removed.
 */
function mockFetch(refuse: readonly string[] = []) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.slice(url.lastIndexOf("/") + 1);
    return refuse.includes(id)
      ? { ok: false, status: 404, json: async () => ({ error: "not_found" }) }
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
        <CustomerBulkActions />
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

describe("CustomerBulkActions — a finished run has to say what it did", () => {
  it("reports how many customers were deactivated", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderActions(["c1", "c2"]);

    await select(user, "c1", "c2");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByText("2 clientes desactivados")).toBeInTheDocument();
  });

  it("keeps the count in the singular when exactly one row applied", async () => {
    const user = userEvent.setup();
    // Two selected, one refused — so the count comes off the OUTCOMES and not
    // off the selection, and the singular is the shape the operator sees.
    mockFetch(["c2"]);
    renderActions(["c1", "c2"]);

    await select(user, "c1", "c2");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByText("1 cliente desactivado")).toBeInTheDocument();
  });

  it("reports a reactivation as a reactivation", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderActions(["c1", "c2"]);

    await select(user, "c1", "c2");
    await user.click(screen.getByRole("button", { name: "Activar" }));

    expect(await screen.findByText("2 clientes reactivados")).toBeInTheDocument();
  });

  /**
   * Nothing applied, so there is nothing to confirm — the result panel already
   * names the rows that failed, and a "0 clientes desactivados" beside it
   * would be a second, emptier copy of the same news.
   */
  it("says nothing when no row applied", async () => {
    const user = userEvent.setup();
    mockFetch(["c1"]);
    renderActions(["c1"]);

    await select(user, "c1");
    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/clientes? desactivados?/)).not.toBeInTheDocument();
  });
});
