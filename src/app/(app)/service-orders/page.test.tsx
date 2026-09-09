/**
 * No list-level test existed for this page before table-column-sorting WU3.
 * Scope stays to sorting (mirrors customers/page.test.tsx's "column sorting"
 * describe block, `getAllByRole("link")` idiom from `page.test.tsx:130-142`),
 * but this file also becomes the first runtime coverage this page has at all.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })),
}));
const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));
vi.mock("@/modules/service-orders/ServiceOrderFormTrigger", () => ({
  ServiceOrderFormTrigger: () => null,
}));
vi.mock("@/modules/service-orders/ServiceOrderFilters", () => ({
  ServiceOrderFilters: () => null,
}));
// WU6's bulk status action calls `router.refresh()` after the run, exactly as
// the row-level `OrderStatusControls` already does. Nothing else on this page
// uses the App Router, which is why this mock did not exist before.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const listOrdenesServicio = vi.hoisted(() => vi.fn());
const countOrdenesServicio = vi.hoisted(() => vi.fn());
vi.mock("@/modules/service-orders/queries", async (importOriginal) => {
  // `ORDEN_SORT`/`parseOrdenSort` are pure and kept real — only the
  // DB-touching reads are faked. Reimplementing the whitelist here would be a
  // mock more convenient than reality, drifting the moment a column changes.
  const actual = await importOriginal<typeof import("@/modules/service-orders/queries")>();
  return { ...actual, listOrdenesServicio, countOrdenesServicio };
});

const listInventory = vi.hoisted(() => vi.fn(async () => ({ items: [] })));
vi.mock("@/modules/inventory-view/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/inventory-view/queries")>();
  return { ...actual, listInventory };
});

import ServiceOrdersPage from "./page";

/** D9's `OrdenServicioListItem` — the joined, narrowed row shape the page now receives. */
function orden(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    status: "open",
    appointmentAt: null,
    clienteName: "Pérez",
    vehiculoPlate: "AB1234",
    vehiculoMake: "Toyota",
    vehiculoModel: "Hilux",
    ...overrides,
  };
}

function renderPage(params: Record<string, string>) {
  listOrdenesServicio.mockResolvedValue([orden()]);
  // More than one page, so the pagination links actually render.
  countOrdenesServicio.mockResolvedValue(40);
  return ServiceOrdersPage({ searchParams: Promise.resolve(params) });
}

describe("ServiceOrdersPage — column sorting", () => {
  beforeEach(() => {
    listOrdenesServicio.mockClear();
    countOrdenesServicio.mockClear();
  });

  it("renders id/status/appointmentAt headers as links carrying ?sort=&dir=asc by default", async () => {
    render(await renderPage({}));

    for (const [name, key] of [
      ["ID", "id"],
      ["Estado", "status"],
      ["Cita", "appointmentAt"],
    ] as const) {
      const url = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://localhost");
      expect(url.searchParams.get("sort")).toBe(key);
      expect(url.searchParams.get("dir")).toBe("asc");
    }

    // The negative half: an excluded column has no clickable header.
    // `Cliente` (unindexed on this list, no joined ORDER BY per D10's
    // "out of scope") replaces `Descripción` here — that column is gone
    // entirely now, covered by its own scenario test below.
    expect(screen.getByRole("columnheader", { name: "Cliente" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cliente" })).not.toBeInTheDocument();
  });

  /** service-orders spec Scenario "Descripción column is gone". */
  it("has no Descripción column, and has Cliente and Vehículo instead", async () => {
    render(await renderPage({}));

    expect(screen.queryByRole("columnheader", { name: "Descripción" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cliente" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Vehículo" })).toBeInTheDocument();
  });

  /** service-orders spec Scenario "ID renders truncated". */
  it("renders the ID cell as exactly the first 8 characters, in monospace — the stored id stays the full UUID", async () => {
    listOrdenesServicio.mockResolvedValue([orden({ id: "87cceecc-1111-2222-3333-444455556666" })]);
    countOrdenesServicio.mockResolvedValue(1);
    render(await ServiceOrdersPage({ searchParams: Promise.resolve({}) }));

    const cell = screen.getByText("87cceecc");
    expect(cell).toHaveClass("font-mono");
    expect(cell).not.toHaveTextContent("87cceecc-1111-2222-3333-444455556666");
  });

  /** service-orders spec Scenario "List shows customer and the car, not just its plate". */
  it("shows the customer name and the vehicle's plate plus make/model", async () => {
    listOrdenesServicio.mockResolvedValue([
      orden({ clienteName: "Pérez", vehiculoPlate: "AB1234", vehiculoMake: "Toyota", vehiculoModel: "Hilux" }),
    ]);
    countOrdenesServicio.mockResolvedValue(1);
    render(await ServiceOrdersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Pérez")).toBeInTheDocument();
    const row = screen.getByText("Pérez").closest("tr")!;
    expect(within(row).getByText("AB1234 Toyota Hilux")).toBeInTheDocument();
  });

  /**
   * service-orders spec Scenario "A vehicle with no make or model still
   * renders its plate" — the dev database already holds a vehicle shaped
   * exactly like this fixture, and a fixture with both set (the test above)
   * cannot catch a naive `${plate} ${make} ${model}` concatenation.
   */
  it("shows the plate alone, with no dangling separator, when make and model are both null", async () => {
    listOrdenesServicio.mockResolvedValue([
      orden({ vehiculoPlate: "CD5678", vehiculoMake: null, vehiculoModel: null }),
    ]);
    countOrdenesServicio.mockResolvedValue(1);
    render(await ServiceOrdersPage({ searchParams: Promise.resolve({}) }));

    const cell = screen.getByText("CD5678");
    expect(cell).toHaveTextContent(/^CD5678$/);
  });

  it("toggles the active column to desc, preserves the status filter and pageSize, and drops page", async () => {
    render(await renderPage({ sort: "status", dir: "asc", status: "open", pageSize: "50", page: "3" }));

    const url = new URL(screen.getByRole("link", { name: "Estado" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("marks only the active header with aria-sort, matching the URL direction", async () => {
    render(await renderPage({ sort: "appointmentAt", dir: "desc" }));

    expect(screen.getByRole("link", { name: "Cita" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["ID", "Estado"]) {
      const header = screen.getByRole("link", { name }).closest("th");
      expect(header).not.toHaveAttribute("aria-sort", "ascending");
      expect(header).not.toHaveAttribute("aria-sort", "descending");
    }
  });

  it("hands the parsed sort to listOrdenesServicio, which is the entire feature", async () => {
    render(await renderPage({ sort: "id", dir: "desc" }));

    expect(listOrdenesServicio.mock.calls[0][2]).toEqual({ key: "id", dir: "desc" });
  });

  it("composes sorting with the status filter — both reach listOrdenesServicio together", async () => {
    render(await renderPage({ sort: "status", dir: "asc", status: "done" }));

    expect(listOrdenesServicio.mock.calls[0][0]).toEqual({ status: "done" });
    expect(listOrdenesServicio.mock.calls[0][2]).toEqual({ key: "status", dir: "asc" });
  });

  it("keeps the sort on every pagination link, like the status filter beside it", async () => {
    render(await renderPage({ sort: "id", dir: "asc", status: "open" }));

    const pageHrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("page="));

    expect(pageHrefs.length).toBeGreaterThan(0);
    // EVERY page link, not just the first — the name says "every" and a
    // `.find()` here would pass while later links silently dropped the sort.
    for (const href of pageHrefs) {
      const url = new URL(href, "http://localhost");
      expect(url.searchParams.get("sort")).toBe("id");
      expect(url.searchParams.get("dir")).toBe("asc");
      expect(url.searchParams.get("status")).toBe("open");
    }
  });

  it("falls back to default order without throwing on a hand-typed garbage sort/dir", async () => {
    render(await renderPage({ sort: "garbage", dir: "sideways" }));

    expect(listOrdenesServicio.mock.calls[0][2]).toBeUndefined();
    expect(screen.getByRole("link", { name: "ID" })).toBeInTheDocument();
  });

  /**
   * D11 — the class of bug `customers/page.tsx:485-489` names by number: a
   * URL builder that does not know about `search` drops it silently the
   * moment staff click a column header or page 2.
   */
  it("keeps the search term on a column-header sort link", async () => {
    render(await renderPage({ search: "perez" }));

    const url = new URL(screen.getByRole("link", { name: "Estado" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("search")).toBe("perez");
  });

  it("keeps the search term on every pagination link", async () => {
    render(await renderPage({ search: "perez", sort: "id", dir: "asc" }));

    const pageHrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("page="));

    expect(pageHrefs.length).toBeGreaterThan(0);
    for (const href of pageHrefs) {
      const url = new URL(href, "http://localhost");
      expect(url.searchParams.get("search")).toBe("perez");
    }
  });

  it("hands the search term to listOrdenesServicio alongside status", async () => {
    render(await renderPage({ search: "perez", status: "open" }));

    expect(listOrdenesServicio.mock.calls[0][0]).toEqual({ status: "open", search: "perez" });
  });
});

/**
 * table-redesign WU6 — bulk status change over the EXISTING per-row route
 * (`service-orders` delta, design D1/D9).
 *
 * There is no bulk endpoint and no batched `UPDATE`: the transport is a
 * sequential client loop over `PATCH /api/service-orders/[id]` with
 * `{status}`, so `assertTransition` is re-evaluated inside each row's own
 * request against that row's CURRENT status, and each row's answer is reported
 * on its own. The menu is where the whole-selection rule is stated up front —
 * it offers the INTERSECTION of every selected row's legal next states, never
 * the union and never the four statuses unconditionally.
 *
 * `/service-orders` has zero rows in the dev database, so the browser check
 * cannot exercise any of this with real data. These tests are the evidence.
 */
describe("ServiceOrdersPage — bulk status change (WU6)", () => {
  const OPEN_PAGE = [
    orden({ id: "o1" }),
    orden({ id: "o2" }),
    orden({ id: "o3" }),
  ];

  beforeEach(() => {
    listOrdenesServicio.mockClear();
    countOrdenesServicio.mockClear();
    vi.unstubAllGlobals();
  });

  function renderAt(items = OPEN_PAGE, params: Record<string, string> = {}) {
    listOrdenesServicio.mockResolvedValue(items);
    countOrdenesServicio.mockResolvedValue(40);
    return ServiceOrdersPage({ searchParams: Promise.resolve(params) });
  }

  /**
   * Keyed by id, so a per-row answer is DECLARED rather than ordered. An
   * ordered `mockResolvedValueOnce` chain would hand whichever response was
   * left over to whichever row ran, which is exactly the thing the drift test
   * below has to be able to tell apart.
   */
  function mockOrdersApi(byId: Record<string, { status: number; body?: unknown }> = {}) {
    const fetchMock = vi.fn(async (url: string) => {
      const id = url.slice(url.lastIndexOf("/") + 1);
      const answer = byId[id] ?? { status: 200, body: { orden: { id } } };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body ?? {},
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function patchesInOrder(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.map(([url, init]) => ({
      id: String(url).slice(String(url).lastIndexOf("/") + 1),
      method: (init as { method: string }).method,
      ...(JSON.parse((init as { body: string }).body) as { status: string }),
    }));
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  type User = ReturnType<typeof userEvent.setup>;

  async function select(user: User, ...ids: string[]) {
    for (const id of ids) {
      await user.click(screen.getByRole("checkbox", { name: `Seleccionar orden ${id}` }));
    }
  }

  async function openStatusMenu(user: User) {
    await user.click(screen.getByRole("button", { name: "Cambiar estado" }));
    // The popup mounts asynchronously; without this every subsequent query
    // races it (the idiom `UsersTable.test.tsx` records for the same base-ui).
    await screen.findByRole("menu");
  }

  function resultPanel() {
    return screen.getByText(/Se aplic/).closest("[role='status']") as HTMLElement;
  }

  /** Spec Scenario "Menu offers only the legal intersection". */
  it("offers only cancelled for 3 open orders plus 1 in_progress", async () => {
    const user = userEvent.setup();
    render(await renderAt([...OPEN_PAGE, orden({ id: "o4", status: "in_progress" })]));

    await select(user, "o1", "o2", "o3", "o4");
    await openStatusMenu(user);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Marcar como Cancelada" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Marcar como En progreso" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Marcar como Completada" })).not.toBeInTheDocument();
  });

  it("offers both of open's next states when every selected order is open", async () => {
    const user = userEvent.setup();
    render(await renderAt());

    await select(user, "o1", "o2");
    await openStatusMenu(user);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Marcar como En progreso" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Marcar como Cancelada" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Marcar como Completada" })).not.toBeInTheDocument();
  });

  /**
   * D9 — an empty intersection DISABLES the action and says why. An enabled
   * trigger opening an empty popup reads as a broken menu, which is the one
   * outcome worse than no menu.
   */
  it("disables the action and says why when nothing is legal for the whole selection", async () => {
    const user = userEvent.setup();
    render(await renderAt([orden({ id: "o1" }), orden({ id: "o2", status: "done" })]));

    await select(user, "o1", "o2");

    expect(screen.getByRole("button", { name: "Cambiar estado" })).toBeDisabled();
    expect(
      screen.getByText("No hay ninguna acción común a esta selección"),
    ).toBeInTheDocument();
  });

  /**
   * A selection that outlives the page it was made on (WU4's whole point) holds
   * ids whose status this page no longer knows. Offering the intersection of
   * the VISIBLE rows would be a claim about rows nobody read — so the action
   * stands down, and says which fact is missing rather than the generic
   * "nothing is legal", which would be a different, unchecked claim.
   */
  it("stands down rather than guessing when part of the selection is off this page", async () => {
    const user = userEvent.setup();
    const { rerender } = render(await renderAt());

    await select(user, "o1");
    rerender(await renderAt([orden({ id: "o9" })], { page: "2" }));
    await settle();
    // o9 is picked TOO, so the visible rows on their own would yield a
    // perfectly good intersection. That is the whole trap: computing over them
    // enables a menu whose promise covers o1, a row this page never read.
    await select(user, "o9");

    expect(screen.getByRole("button", { name: "Cambiar estado" })).toBeDisabled();
    expect(
      screen.getByText(
        "No se puede calcular la acción común: 1 orden seleccionada está fuera de esta página",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay ninguna acción común a esta selección")).not.toBeInTheDocument();
  });

  /** Task 6.5 — one PATCH per row, in selection order, never a batch. */
  it("sends one PATCH per selected order with {status}, in selection order", async () => {
    const user = userEvent.setup();
    const fetchMock = mockOrdersApi();
    render(await renderAt());

    await select(user, "o1", "o2");
    await openStatusMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Marcar como En progreso" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(patchesInOrder(fetchMock)).toEqual([
      { id: "o1", method: "PATCH", status: "in_progress" },
      { id: "o2", method: "PATCH", status: "in_progress" },
    ]);
  });

  /**
   * Spec Scenario "Concurrent status drift still fails safely, per row".
   *
   * The page data says all three are `open`, which is why the menu offered
   * `cancelled` at all; the SERVER says `o2` is already `done`. That gap is the
   * race, and only a per-row request can show it: the batch keeps going, the
   * two rows still legal are cancelled, and the drifted one is named with the
   * reason its current status no longer allows the transition.
   */
  it("applies the rows still legal and names the drifted one when a status moved under the selection", async () => {
    const user = userEvent.setup();
    const fetchMock = mockOrdersApi({
      o2: { status: 400, body: { error: "invalid_transition", from: "done", to: "cancelled" } },
    });
    render(await renderAt());

    await select(user, "o1", "o2", "o3");
    await openStatusMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Marcar como Cancelada" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));

    // Three requests: the refusal in the middle stops neither the loop nor the
    // reporting of the rows that already applied.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(patchesInOrder(fetchMock).map((p) => p.id)).toEqual(["o1", "o2", "o3"]);

    const panel = resultPanel();
    expect(panel).toHaveTextContent("Se aplicaron 2 filas y 1 no se pudo.");
    const failed = within(panel).getAllByRole("listitem");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toHaveTextContent("orden o2");
    expect(failed[0]).toHaveTextContent("Su estado actual ya no permite ese cambio");
  });

  /**
   * Spec Scenario "Terminal-status warning shown before applying". `done` and
   * `cancelled` have no outgoing edges, so the operator has to be told the move
   * is one-way BEFORE it runs — and nothing may be sent until they confirm.
   */
  it("warns that a move to a terminal status cannot be undone, before sending anything", async () => {
    const user = userEvent.setup();
    const fetchMock = mockOrdersApi();
    render(await renderAt());

    await select(user, "o1");
    await openStatusMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Marcar como Cancelada" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/no se puede deshacer desde la aplicación/i);

    // Settled first: the assertion is that the request NEVER went out, and one
    // taken synchronously after a rerender would pass while the fetch was a
    // microtask away.
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  /**
   * The negative half: `in_progress` HAS outgoing edges, so the terminal
   * sentence must not appear over it. Without this, hardcoding the warning into
   * the dialog passes the scenario above while telling the operator something
   * false about every non-terminal move.
   */
  it("does not call a non-terminal move irreversible", async () => {
    const user = userEvent.setup();
    mockOrdersApi();
    render(await renderAt());

    await select(user, "o1");
    await openStatusMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Marcar como En progreso" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("En progreso");
    expect(dialog).not.toHaveTextContent(/no se puede deshacer/i);
  });
});

/**
 * The empty state is a CLAIM, and "todavía no hay órdenes registradas" is false
 * the moment a search simply misses over a database holding forty of them.
 * `customers/page.tsx` learned this and wrote it down; this screen taught four
 * URL builders about `search` and left the fifth consumer of `filters` alone.
 *
 * No test reached this before — `rg "No se encontraron órdenes"` over the test
 * files returned nothing, which is exactly the condition AGENTS.md warns a
 * green suite about.
 */
describe("ServiceOrdersPage — the empty state does not lie", () => {
  function renderEmpty(params: Record<string, string>) {
    listOrdenesServicio.mockResolvedValue([]);
    countOrdenesServicio.mockResolvedValue(0);
    return ServiceOrdersPage({ searchParams: Promise.resolve(params) });
  }

  it("says the search matched nothing, not that no orders exist", async () => {
    render(await renderEmpty({ search: "zzzz" }));

    expect(screen.getByText(/Ninguna orden coincide con la búsqueda/)).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay órdenes de servicio registradas/)).not.toBeInTheDocument();
  });

  it("still says there are none when there genuinely are none", async () => {
    render(await renderEmpty({}));

    expect(screen.getByText(/Todavía no hay órdenes de servicio registradas/)).toBeInTheDocument();
  });
});
