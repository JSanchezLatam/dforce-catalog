/**
 * table-column-sorting WU2 — this table has no list-level page test today,
 * so this file also covers the page's existing untested filter/pagination
 * behavior incidentally, but scope stays to sorting (mirrors
 * `customers/page.test.tsx`'s "column sorting" describe block from WU1).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      ["Name", "name"],
      ["Category L1", "categoryL1"],
      ["Category L2", "categoryL2"],
    ] as const) {
      const url = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://localhost");
      expect(url.searchParams.get("sort")).toBe(key);
      expect(url.searchParams.get("dir")).toBe("asc");
    }

    // The negative half: `stock`/`price` have no rendered header at all, so
    // there is nothing to assert a link against — Acciones is the only
    // remaining non-sortable header.
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

    const url = new URL(screen.getByRole("link", { name: "Name" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("categoryL1")).toBe("REPUESTOS");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("marks only the active header with aria-sort, matching the URL direction", async () => {
    render(await renderPage({ sort: "categoryL2", dir: "desc" }));

    expect(screen.getByRole("link", { name: "Category L2" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["ID", "Name", "Category L1"]) {
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
    expect(screen.getByRole("link", { name: "Name" })).toBeInTheDocument();
  });
});
