/**
 * `page.test.tsx` already pins what the bulk run SENDS (one PATCH per row, in
 * selection order) and what the result panel says about the rows that failed.
 * What nothing pinned is the other half: the operator ticks rows, confirms,
 * and the run ends by clearing the selection and refreshing the list — so on a
 * fully successful run the bar they were looking at simply disappears and the
 * rows repaint with a status they have to go and read. A count of what
 * actually changed is the difference between that and a confirmation.
 *
 * The count is the SUCCESSES, never `ids.length`: the drift case (a row whose
 * status moved under the selection) is a real, tested outcome of this run, and
 * a toast saying "3 órdenes actualizadas" beside a panel naming one that
 * failed is the component contradicting itself on screen.
 *
 * See `.claude/skills/component-testing/SKILL.md` for why this is `.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, describe, it, vi } from "vitest";

import { BulkResultPanel } from "@/shared/ui/selection/BulkResultPanel";
import { RowCheckbox } from "@/shared/ui/selection/RowCheckbox";
import { SelectionProvider } from "@/shared/ui/selection/SelectionProvider";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { OrderBulkStatusActions } from "./OrderBulkStatusActions";
import type { OrderStatus } from "./transitions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const PAGE_IDS = ["o1", "o2", "o3"];
const STATUSES: Record<string, OrderStatus | undefined> = { o1: "open", o2: "open", o3: "open" };

/** Keyed by id, so a per-row answer is declared rather than ordered — `page.test.tsx`'s idiom. */
function mockOrdersApi(byId: Record<string, { status: number; body?: unknown }> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = String(url).slice(String(url).lastIndexOf("/") + 1);
    const answer = byId[id] ?? { status: 200, body: { orden: { id } } };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body ?? {},
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderActions() {
  return render(
    <ToastProvider>
      <SelectionProvider
        pageIds={PAGE_IDS}
        labels={{ o1: "orden o1", o2: "orden o2", o3: "orden o3" }}
        filterKey="test"
      >
        {PAGE_IDS.map((id) => (
          <RowCheckbox key={id} id={id} label={`orden ${id}`} />
        ))}
        <OrderBulkStatusActions statuses={STATUSES} />
        {/* The sibling every list page mounts beside the action — it is what names
            the rows that failed, and what proves the run finished. */}
        <BulkResultPanel />
      </SelectionProvider>
    </ToastProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function applyInProgress(user: User, ...ids: string[]) {
  for (const id of ids) {
    await user.click(screen.getByRole("checkbox", { name: `Seleccionar orden ${id}` }));
  }
  await user.click(screen.getByRole("button", { name: "Cambiar estado" }));
  // The popup mounts asynchronously; without this every subsequent query races
  // it (the idiom `UsersTable.test.tsx` records for the same base-ui).
  await screen.findByRole("menu");
  await user.click(screen.getByRole("menuitem", { name: "Marcar como En progreso" }));
  await user.click(await screen.findByRole("button", { name: "Confirmar" }));
}

describe("OrderBulkStatusActions — the run ends by emptying the bar, so it has to say what it did", () => {
  it("counts the orders it changed, in the plural", async () => {
    const user = userEvent.setup();
    mockOrdersApi();
    renderActions();

    await applyInProgress(user, "o1", "o2");

    expect(await screen.findByText("2 órdenes actualizadas")).toBeInTheDocument();
  });

  it("says it in the singular for one order", async () => {
    const user = userEvent.setup();
    mockOrdersApi();
    renderActions();

    await applyInProgress(user, "o1");

    expect(await screen.findByText("1 orden actualizada")).toBeInTheDocument();
    expect(screen.queryByText("1 órdenes actualizadas")).not.toBeInTheDocument();
  });

  /**
   * The drift case, from the operator's side. The panel names `o2` and its
   * reason; the toast must count two, not three, or the two halves of the same
   * run disagree on screen about how many orders moved.
   */
  it("counts only the rows that applied when one of them was refused", async () => {
    const user = userEvent.setup();
    mockOrdersApi({ o2: { status: 400, body: { error: "invalid_transition", from: "done", to: "in_progress" } } });
    renderActions();

    await applyInProgress(user, "o1", "o2", "o3");

    expect(await screen.findByText("2 órdenes actualizadas")).toBeInTheDocument();
    expect(screen.queryByText("3 órdenes actualizadas")).not.toBeInTheDocument();
  });

  /**
   * Nothing changed, so nothing is confirmed. The result panel is already
   * saying which rows failed and why; a success toast over it would be the
   * component announcing a change it just failed to make.
   */
  it("stays quiet when every row was refused", async () => {
    const user = userEvent.setup();
    mockOrdersApi({
      o1: { status: 400, body: { error: "invalid_transition" } },
      o2: { status: 400, body: { error: "invalid_transition" } },
    });
    renderActions();

    await applyInProgress(user, "o1", "o2");

    // The panel proves the run finished, so "no toast" is an outcome rather
    // than a race against one that had not appeared yet.
    expect(await screen.findByText(/Se aplicaron 0 filas y 2 no se pudieron/)).toBeInTheDocument();
    expect(screen.queryByText(/actualizada/)).not.toBeInTheDocument();
  });
});
