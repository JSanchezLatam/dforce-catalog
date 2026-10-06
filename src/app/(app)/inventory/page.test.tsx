/**
 * table-column-sorting WU2 — this table has no list-level page test today,
 * so this file also covers the page's existing untested filter/pagination
 * behavior incidentally, but scope stays to sorting (mirrors
 * `customers/page.test.tsx`'s "column sorting" describe block from WU1).
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can }));
vi.mock("@/modules/inventory-view/InventoryFilters", () => ({ InventoryFilters: () => null }));
vi.mock("@/modules/inventory-view/InventoryStatsHeader", () => ({ InventoryStatsHeader: () => null }));
vi.mock("@/modules/inventory-sync/ManualSyncButton", () => ({ ManualSyncButton: () => null }));

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
const listInventory = vi.hoisted(() => vi.fn());
const listCategoryL1Options = vi.hoisted(() => vi.fn(async () => [] as string[]));
const listCategoryL2Options = vi.hoisted(() => vi.fn(async () => [] as string[]));
const countAllProducts = vi.hoisted(() => vi.fn(async () => 0));
const hasAnyProducts = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/modules/inventory-view/queries", async (importOriginal) => {
  // `INVENTORY_SORT`/`parseInventorySort` are pure and the real
  // implementation — only the DB-touching reads are faked. Reimplementing
  // the whitelist here would be a mock more convenient than reality, drifting
  // from `queries.ts` the moment a column is added or removed there.
  const actual = await importOriginal<typeof import("@/modules/inventory-view/queries")>();
  return { ...actual, listInventory, listCategoryL1Options, listCategoryL2Options, countAllProducts, hasAnyProducts };
});

import InventoryPage from "./page";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "PS0000001",
    name: "Filtro de aceite",
    categoryL1: "REPUESTOS",
    categoryL2: null,
    price: 10,
    stock: 5,
    ...overrides,
  };
}

function renderPage(params: Record<string, string>) {
  listInventory.mockResolvedValue({ items: [row()], total: 40 });
  return InventoryPage({ searchParams: Promise.resolve(params) });
}

describe("InventoryPage — column sorting", () => {
  beforeEach(() => {
    listInventory.mockClear();
  });

  it("renders id/name/categoryL1/categoryL2 headers as links carrying ?sort=&dir=asc by default", async () => {
    render(await renderPage({}));

    for (const [name, key] of [
      ["ID", "id"],
      ["Nombre", "name"],
      ["Categoría 1", "categoryL1"],
      ["Categoría 2", "categoryL2"],
    ] as const) {
      const url = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://localhost");
      expect(url.searchParams.get("sort")).toBe(key);
      expect(url.searchParams.get("dir")).toBe("asc");
    }

    // The negative half: Precio, Stock and Acciones are the non-sortable
    // headers. Precio and Stock are pinned (no sort link) in the WU7 block
    // below; Acciones is checked here.
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acciones" })).not.toBeInTheDocument();
  });

  it("toggles the active column to desc and preserves filters/pageSize while dropping page", async () => {
    render(
      await renderPage({
        sort: "name",
        dir: "asc",
        categoryL1: "REPUESTOS",
        pageSize: "50",
        page: "3",
      }),
    );

    const url = new URL(screen.getByRole("link", { name: "Nombre" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("categoryL1")).toBe("REPUESTOS");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("marks only the active header with aria-sort, matching the URL direction", async () => {
    render(await renderPage({ sort: "categoryL2", dir: "desc" }));

    expect(screen.getByRole("link", { name: "Categoría 2" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["ID", "Nombre", "Categoría 1"]) {
      const header = screen.getByRole("link", { name }).closest("th");
      expect(header).not.toHaveAttribute("aria-sort", "ascending");
      expect(header).not.toHaveAttribute("aria-sort", "descending");
    }
  });

  /**
   * The whole point of the work unit: the page parses the sort and HANDS IT
   * to the query. Dropping the third argument to `listInventory` would leave
   * both files green — the suite pins the hrefs, the `aria-sort`, and the
   * negative case, and never the positive one.
   */
  it("hands the parsed sort to listInventory, which is the entire feature", async () => {
    render(await renderPage({ sort: "categoryL1", dir: "desc" }));

    expect(listInventory.mock.calls[0][2]).toEqual({ key: "categoryL1", dir: "desc" });
  });

  /**
   * The one href builder this page has (`buildPagePattern`) must carry the
   * sort too, or paging by a sorted column repeats/skips rows — the exact
   * failure `buildClienteOrderBy`'s tiebreaker exists to prevent, arriving
   * through a different door (WU1 finding: "find EVERY href builder").
   */
  it("keeps the sort on the pagination link pattern", async () => {
    listInventory.mockResolvedValue({ items: [row()], total: 400 });
    render(await renderPage({ sort: "name", dir: "asc" }));

    const pageLink = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .find((href) => href.includes("page="));

    expect(pageLink).toBeDefined();
    // `{page}` is the literal pagination placeholder, not percent-encoded.
    expect(pageLink).toContain("sort=name");
    expect(pageLink).toContain("dir=asc");
  });

  it("falls back to default order without throwing on a hand-typed garbage sort/dir", async () => {
    render(await renderPage({ sort: "garbage", dir: "sideways" }));

    expect(listInventory.mock.calls[0][2]).toBeUndefined();
    expect(screen.getByRole("link", { name: "Nombre" })).toBeInTheDocument();
  });
});

/**
 * WU7a — the transport half of inventory → generador (`catalog-generation`
 * delta, design D10). What is pinned here is the SENDING side only: the ids
 * that leave, and the refusal that stops them leaving. The builder accepting
 * them is WU7b.
 *
 * `filterKey` is `JSON.stringify(filters)` and `InventoryFilters` has no
 * `sort`/`page`/`pageSize` member, so the type itself is what keeps a column
 * click from wiping the operator's selection — the rule `customers/page.tsx`
 * has to hold by hand in its `buildFilterKey`.
 */
describe("InventoryPage — selection and the catalog handoff (WU7a)", () => {
  const PAGE = [
    row({ id: "PS0000001", name: "Filtro de aceite" }),
    row({ id: "PS0000002", name: "Bujía" }),
  ];

  beforeEach(() => {
    listInventory.mockClear();
    push.mockClear();
    can.mockImplementation(() => true);
  });

  afterEach(() => {
    can.mockImplementation(() => true);
  });

  function renderAt(items = PAGE, params: Record<string, string> = {}) {
    listInventory.mockResolvedValue({ items, total: items.length });
    return InventoryPage({ searchParams: Promise.resolve(params) });
  }

  /**
   * Let anything pending resolve before asserting a NEGATIVE. A synchronous
   * `expect(push).not.toHaveBeenCalled()` right after a click passes while the
   * navigation is one microtask away — the placebo that already got past this
   * change's unit 4 once.
   */
  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  /**
   * The cap is written out as 201/200 rather than as `MAX_TOTAL_PRODUCTS + 1`.
   * Taken from the constant, this test follows the constant anywhere: raising
   * the export to 300 left it green — measured, not assumed — which makes it a
   * test of the arithmetic, not of the limit. The literals are what fail when
   * the number moves.
   */
  it("refuses to send a selection over the 200 cap, in Spanish, before navigating", async () => {
    const overCap = Array.from({ length: 201 }, (_, i) =>
      row({ id: `PS${String(i).padStart(7, "0")}`, name: `Producto ${i}` }),
    );
    const user = userEvent.setup();
    render(await renderAt(overCap));

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todo lo de esta página" }));
    await user.click(screen.getByRole("button", { name: "Enviar al generador" }));
    await settle();

    // The same sentence `validateCatalogSelection` already refuses with, not a
    // second phrasing of the same limit.
    expect(screen.getByRole("alert")).toHaveTextContent("Seleccionaste 201, el máximo es 200");
    expect(push).not.toHaveBeenCalled();
  });

  it("allows exactly the cap, which is what pins the comparison's direction", async () => {
    const atCap = Array.from({ length: 200 }, (_, i) =>
      row({ id: `PS${String(i).padStart(7, "0")}`, name: `Producto ${i}` }),
    );
    const user = userEvent.setup();
    render(await renderAt(atCap));

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todo lo de esta página" }));
    await user.click(screen.getByRole("button", { name: "Enviar al generador" }));
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("hands the builder the selected ids as ?products=, comma separated", async () => {
    const user = userEvent.setup();
    render(await renderAt());

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Filtro de aceite" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Bujía" }));
    await user.click(screen.getByRole("button", { name: "Enviar al generador" }));
    await settle();

    // The exact URL, not a `toContain`: the ids that leave ARE the feature,
    // and a builder reading `?products=` cannot see a separator that changed.
    expect(push).toHaveBeenCalledWith("/builder?products=PS0000001,PS0000002");
  });

  it("renders a checkbox per row plus a select-all for the current page", async () => {
    render(await renderAt());

    expect(screen.getByRole("checkbox", { name: "Seleccionar Filtro de aceite" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Seleccionar Bujía" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar todo lo de esta página" }),
    ).toBeInTheDocument();
  });

  /**
   * `tecnico` reads inventory and cannot generate catalogs (`policy.ts`), and
   * the handoff is the only thing selection does on this table — so offering
   * the column at all would offer a bulk action whose only outcome is
   * `/builder`'s permission page.
   */
  it("offers no selection at all to a user who cannot generate catalogs", async () => {
    can.mockImplementation((_user, action) => action !== "catalogs.generate");
    render(await renderAt());

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar al generador" })).not.toBeInTheDocument();
    // Still a readable inventory, not a denied page.
    expect(within(screen.getByTestId("inventory-table")).getByText("Filtro de aceite")).toBeInTheDocument();
  });

  /** WU2's kebab is not regressed by the column that landed to its left. */
  it("keeps the row kebab and its Ver item", async () => {
    const user = userEvent.setup();
    render(await renderAt());

    await user.click(screen.getByRole("button", { name: "Acciones de Filtro de aceite" }));
    expect(await screen.findByRole("menuitem", { name: "Ver" })).toHaveAttribute(
      "href",
      "/inventory/PS0000001",
    );
  });

  /**
   * The negative half of D5 on this table: `filterKey` is built from the
   * FILTERS only, so sorting a column or turning a page must leave the
   * selection alone. `settle()` is load-bearing here — the clearing this
   * asserts against is a promise resolution away.
   */
  it("does not clear the selection when a column is sorted or the page size changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(await renderAt());

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Filtro de aceite" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 seleccionado");

    rerender(await renderAt(PAGE, { sort: "name", dir: "desc" }));
    await settle();
    rerender(await renderAt(PAGE, { sort: "name", dir: "desc", pageSize: "50", page: "2" }));
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("1 seleccionado");
    expect(screen.queryByText(/Se limpió la selección/)).not.toBeInTheDocument();
  });

  it("clears the selection when a real filter changes, saying how many went", async () => {
    const user = userEvent.setup();
    const { rerender } = render(await renderAt());

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Filtro de aceite" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Bujía" }));

    rerender(await renderAt(PAGE, { categoryL1: "REPUESTOS" }));
    await settle();

    expect(screen.getByText("Se limpió la selección de 2 al cambiar el filtro")).toBeInTheDocument();
  });
});

/**
 * mobile-responsive-pass WU7 — Precio and Stock become plain desktop columns,
 * and below md the table is replaced by cards mapped from the SAME items array.
 * jsdom computes no media query, so what is asserted is the class contract and
 * each container's content, scoped with `within` because both are in the DOM.
 */
describe("InventoryPage — price/stock columns and phone cards (WU7)", () => {
  beforeEach(() => {
    listInventory.mockClear();
    can.mockImplementation(() => true);
  });

  async function renderItems(items: unknown[], params: Record<string, string> = {}) {
    listInventory.mockResolvedValue({ items, total: items.length });
    render(await InventoryPage({ searchParams: Promise.resolve(params) }));
    return {
      table: within(screen.getByTestId("inventory-table")),
      cards: within(screen.getByTestId("inventory-cards")),
    };
  }

  it("renders Precio and Stock as plain headers with no sort control, the sortable set unchanged", async () => {
    const { table } = await renderItems([row()]);

    expect(table.getByRole("columnheader", { name: "Precio" })).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: "Stock" })).toBeInTheDocument();
    expect(table.queryByRole("link", { name: "Precio" })).not.toBeInTheDocument();
    expect(table.queryByRole("link", { name: "Stock" })).not.toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: "Precio" })).not.toHaveAttribute("aria-sort");
    for (const name of ["ID", "Nombre", "Categoría 1", "Categoría 2"]) {
      expect(table.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("shows price as $x.00 and the stock figure in the desktop row, and a dash for a missing value", async () => {
    const { table } = await renderItems([
      row({ id: "PS0000001", price: 12.5, stock: 24 }),
      row({ id: "PS0000002", name: "Sin datos", price: null, stock: null }),
    ]);

    const [header, full, empty] = table.getAllByRole("row");
    const headers = within(header).getAllByRole("columnheader").map((h) => h.textContent?.trim());
    const cell = (r: HTMLElement, name: string) => within(r).getAllByRole("cell")[headers.indexOf(name)];
    expect(cell(full, "Precio")).toHaveTextContent("$12.50");
    expect(cell(full, "Stock")).toHaveTextContent("24");
    // Read by column, not by counting dashes: Categoría 2 is null in the
    // fixture too, so a dash count cannot tell a missing stock dash apart.
    expect(cell(empty, "Precio")).toHaveTextContent(/^—$/);
    expect(cell(empty, "Stock")).toHaveTextContent(/^—$/);
  });

  it("hides the table below md and the card list from md up", async () => {
    await renderItems([row()]);

    expect(screen.getByTestId("inventory-table")).toHaveClass("hidden", "md:block");
    expect(screen.getByTestId("inventory-cards")).toHaveClass("md:hidden");
  });

  it("makes each card ONE link to the product, named by name and code", async () => {
    const { cards } = await renderItems([row({ id: "PS0000570", name: "Super tweeter" })]);

    const link = cards.getByRole("link");
    expect(link).toHaveAttribute("href", "/inventory/PS0000570");
    expect(link).toHaveAccessibleName(/Super tweeter/);
    expect(link).toHaveAccessibleName(/PS0000570/);
    expect(within(link).getByText("PS0000570")).toHaveClass("font-mono");
  });

  it("shows price and 'Stock N' on the card", async () => {
    const { cards } = await renderItems([row({ price: 9.75, stock: 48 }), row({ id: "PS0000002", price: 85, stock: 2 })]);

    const [first, second] = cards.getAllByRole("link");
    expect(first).toHaveTextContent("$9.75");
    expect(first).toHaveTextContent("Stock 48");
    expect(second).toHaveTextContent("$85.00");
    expect(second).toHaveTextContent("Stock 2");
  });

  it("shows a red 'Sin stock' chip at 0 and no 'Stock 0'", async () => {
    const { cards } = await renderItems([row({ stock: 0 }), row({ id: "PS0000002", stock: 3 })]);

    const [empty, stocked] = cards.getAllByRole("link");
    expect(within(empty).getByText("Sin stock").className).toContain("text-red-800");
    expect(empty).not.toHaveTextContent("Stock 0");
    expect(stocked).not.toHaveTextContent("Sin stock");
  });

  it("renders a dash, not $null or Stock NaN, for a missing price or stock", async () => {
    const { cards } = await renderItems([row({ price: null, stock: null })]);

    const link = cards.getByRole("link");
    expect(link).not.toHaveTextContent(/null|NaN|\$/);
    expect(link).toHaveTextContent("Stock —");
  });

  it("renders no checkbox in the cards", async () => {
    const { cards } = await renderItems([row()]);

    expect(cards.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders as many cards as table rows", async () => {
    const { table, cards } = await renderItems([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);

    expect(cards.getAllByRole("listitem")).toHaveLength(3);
    expect(table.getAllByRole("row")).toHaveLength(1 + 3);
  });

  it("keeps the catalog handoff bar out of reach below md", async () => {
    const user = userEvent.setup();
    await renderItems([row()]);

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Filtro de aceite" }));

    const bar = screen.getByText("1 seleccionado").closest("[role='status']") as HTMLElement;
    expect(bar.parentElement).toHaveClass("hidden", "md:block");
  });
});

// Audit WU3 carry-over: the técnico's one-line subtitle was a `md:hidden` SPAN
// inside an always-rendered `<p className="mt-1">`, so at desktop the `<p>`
// stayed behind, empty, still taking its margin. The `<p>` itself now hides.
describe("InventoryPage — the phone-only subtitle (mobile-responsive-pass 9.y)", () => {
  beforeEach(() => {
    listInventory.mockResolvedValue({ items: [row()], total: 1 });
    can.mockImplementation((_user, action) => action !== "sync.manual");
  });

  async function subtitleFor(count: number) {
    countAllProducts.mockResolvedValueOnce(count);
    render(await InventoryPage({ searchParams: Promise.resolve({}) }));
    return screen.getByText(/sincronizados? desde Interfuerza/);
  }

  it("hides the paragraph itself from md, so desktop keeps no empty margin box", async () => {
    const subtitle = await subtitleFor(7);

    expect(subtitle).toHaveTextContent("7 productos sincronizados desde Interfuerza");
    expect(subtitle.tagName).toBe("P");
    expect(subtitle).toHaveClass("md:hidden");
  });

  it("keeps the singular", async () => {
    const subtitle = await subtitleFor(1);

    expect(subtitle).toHaveTextContent("1 producto sincronizado desde Interfuerza");
    expect(subtitle.tagName).toBe("P");
    expect(subtitle).toHaveClass("md:hidden");
  });

  it("gives the administrador no subtitle: the stats card holds the sync button instead", async () => {
    can.mockImplementation(() => true);
    countAllProducts.mockResolvedValueOnce(7);
    render(await InventoryPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByText(/sincronizados? desde Interfuerza/)).not.toBeInTheDocument();
  });
});
