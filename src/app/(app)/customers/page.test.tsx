/**
 * R20 — written because GGA found `buildPageHref` dropping the status filter:
 * turn on "Ver desactivados", page to 2, and the flag vanished so the list
 * silently narrowed back to active-only. Every unit test was green and this
 * file did not exist.
 *
 * Same failure class as the one the e2e caught one commit earlier (the flag
 * wired into one layer and not the next), which is why the pagination link is
 * asserted here rather than trusted.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can }));
vi.mock("@/modules/customers/CustomerFormTrigger", () => ({ CustomerFormTrigger: () => null }));
vi.mock("@/modules/customer-import/CustomerSyncPanel", () => ({
  // Renders BOTH props. The panel's own suite proves it honours `canSync`;
  // nothing proved this page computes it, so replacing the R21 gate with a
  // hardcoded `true` left the whole file green — a mock more convenient than
  // reality, sitting on a permission boundary.
  CustomerSyncPanel: ({ total, canSync }: { total: number; canSync: boolean }) => (
    <div data-testid="sync-panel" data-can-sync={String(canSync)}>
      {total}
    </div>
  ),
}));
vi.mock("@/modules/customers/CustomerFilters", () => ({ CustomerFilters: () => null }));

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
const listClientes = vi.hoisted(() => vi.fn());
const countClientes = vi.hoisted(() => vi.fn());
vi.mock("@/modules/customers/queries", async (importOriginal) => {
  // `CLIENTE_SORT`/`parseClienteSort` are pure and the real implementation —
  // only the DB-touching reads are faked. Reimplementing the whitelist here
  // would be a mock more convenient than reality, drifting from `queries.ts`
  // the moment a column is added or removed there.
  const actual = await importOriginal<typeof import("@/modules/customers/queries")>();
  return { ...actual, listClientes, countClientes };
});

import CustomersPage from "./page";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "Retirado Perez",
    phone: "50761111111",
    email: null,
    deactivatedAt: null,
    plates: [],
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/**
 * Keyed on the filter, not on call order. Three counts can run per render now
 * (the paginated one, the unfiltered one behind the stats card, and the
 * deactivated probe), and an ordered `mockResolvedValueOnce` chain quietly fed
 * the probe whatever value was left over — a fixture passing for a reason the
 * test does not state. Reads as: three customers exist, none of them active.
 */
async function countByStatus(filters: { status?: string }) {
  return (filters.status ?? "active") === "active" ? 0 : 3;
}

function renderPage(params: Record<string, string>) {
  listClientes.mockResolvedValue([row({ deactivatedAt: new Date("2026-09-01") })]);
  // More than one page, so the pagination links actually render.
  countClientes.mockResolvedValue(40);
  return CustomersPage({ searchParams: Promise.resolve(params) });
}

/**
 * The `status=inactive` empty state. Its two siblings each carry two tests;
 * this one shipped with none — deleting the whole branch left the suite green.
 * It is the same class those two exist for: an empty screen that claims more
 * than it knows. "Todavía no hay clientes registrados" over 368 active
 * customers is simply false.
 */
describe("CustomersPage — the empty state for the deactivated-only filter", () => {
  it("does not claim the database is empty when only the filter is", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockResolvedValue(0);

    render(await CustomersPage({ searchParams: Promise.resolve({ status: "inactive" }) }));

    expect(screen.getByText(/Ningún cliente desactivado/)).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay clientes registrados/)).not.toBeInTheDocument();
  });

  it("offers the way back to the active list, keeping the other filters", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockResolvedValue(0);

    render(
      await CustomersPage({
        searchParams: Promise.resolve({ status: "inactive", pageSize: "50" }),
      }),
    );

    const href = new URL(
      screen.getByRole("link", { name: "Ver los activos" }).getAttribute("href")!,
      "http://localhost",
    );
    expect(href.searchParams.get("status")).toBeNull();
    // `pageSize` survives: the defect WU14.2 fixed on the sibling links.
    expect(href.searchParams.get("pageSize")).toBe("50");
  });
});

describe("CustomersPage — deactivated customers (R20)", () => {
  // Without this, `mock.calls[0]` is the FIRST call of the whole file, not of
  // the current test - which silently asserted the previous test's filters.
  beforeEach(() => {
    listClientes.mockClear();
    countClientes.mockClear();
  });

  it("asks for active customers only by default", async () => {
    render(await renderPage({}));
    expect(listClientes.mock.calls[0][0].status).toBeUndefined();
  });

  it("passes status=all through when the URL asks for it", async () => {
    render(await renderPage({ status: "all" }));
    expect(listClientes.mock.calls[0][0].status).toBe("all");
    expect(countClientes.mock.calls[0][0].status).toBe("all");
  });

  it("falls back to the default for a value it does not know", async () => {
    render(await renderPage({ status: "garbage" }));
    expect(listClientes.mock.calls[0][0].status).toBeUndefined();
  });

  // THE BUG. Every pagination link has to carry the flag; without it page 2
  // reads as "the deactivated records disappeared" rather than "the filter
  // reset itself".
  it("keeps the status on every pagination link", async () => {
    render(await renderPage({ status: "all" }));

    const pageLinks = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("page="));

    expect(pageLinks.length).toBeGreaterThan(0);
    for (const href of pageLinks) {
      expect(href).toContain("status=all");
    }
  });

  it("keeps the search term on pagination links too, alongside the flag", async () => {
    render(await renderPage({ status: "all", search: "perez" }));

    const href = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => h.includes("page="));

    expect(href).toContain("search=perez");
    expect(href).toContain("status=all");
  });

  it("marks a listed deactivated customer instead of mixing it in silently", async () => {
    render(await renderPage({ status: "all" }));
    expect(screen.getByText("Desactivado")).toBeInTheDocument();
  });

  // Migration `0016` made `phone` NOT NULL, so "no phone on record" became
  // `""` — and the cell used `??`, which is NULLISH. The phone column rendered
  // blank while every other column showed an em dash. `design.md` D4 audited
  // this class and enumerated the consumers; it missed this one.
  it("renders an em dash for a customer with no phone on record", async () => {
    listClientes.mockResolvedValue([row({ phone: "", email: "a@b.com", plates: ["ABC111"] })]);
    countClientes.mockResolvedValue(1);
    render(await CustomersPage({ searchParams: Promise.resolve({}) }));

    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    // Indexed on the phone column rather than "no cell in the row is blank".
    // That blanket form worked only while every cell carried text, and the
    // Acciones cell is now an icon-only kebab trigger whose `textContent` is
    // legitimately "" — it would fail this test for the wrong reason while
    // saying nothing about the phone. Column order: Nombre | Teléfono | Email
    // | Vehículos | Acciones.
    expect(cells[1]).toBe("—");
  });

  // R20 — searching is how staff reach one specific customer. Before this the
  // screen said they did not match and offered only "Limpiar filtro": the
  // record was one query-string key away and nothing said so.
  it("offers to widen a search that matched no ACTIVE customer, keeping the term", async () => {
    listClientes.mockResolvedValue([]);
    // Nothing active matches, and three customers exist behind the offer.
    countClientes.mockImplementation(countByStatus);
    render(await CustomersPage({ searchParams: Promise.resolve({ search: "Retirado Perez" }) }));

    // Semantics, not an exact string: the href goes through `buildPageHref`,
    // which encodes a space as `+` and pins `page=1`. Asserting the literal
    // would break on a formatting change that costs the operator nothing.
    const href = new URL(
      screen.getByRole("link", { name: /desactivados/i }).getAttribute("href")!,
      "http://localhost",
    );
    expect(href.searchParams.get("search")).toBe("Retirado Perez");
    expect(href.searchParams.get("status")).toBe("all");
  });

  it("keeps pageSize on the widen-search link, like the pagination links do", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockImplementation(countByStatus);
    render(await CustomersPage({ searchParams: Promise.resolve({ search: "x", pageSize: "50" }) }));

    const href = screen.getByRole("link", { name: /desactivados/i }).getAttribute("href")!;
    expect(href).toContain("pageSize=50");
  });

  it("does not offer it again once deactivated records are already included", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockResolvedValue(0);
    render(await CustomersPage({ searchParams: Promise.resolve({ search: "nadie", status: "all" }) }));

    expect(screen.queryByRole("link", { name: /desactivados/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Limpiar filtro" })).toBeInTheDocument();
  });

  // A genuinely empty database must not offer a link to another empty page,
  // and must be able to say so — before this, "Todavía no hay clientes
  // registrados" was reachable only WITH the deactivated ones in view, the one case
  // where it is least true.
  it("does not offer Ver desactivados when there are none to see", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockResolvedValue(0);
    render(await CustomersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("link", { name: /desactivados/i })).not.toBeInTheDocument();
    expect(screen.getByText("Todavía no hay clientes registrados.")).toBeInTheDocument();
  });

  /**
   * R21 — the import trigger is gated on `customers.write`, and the gate is
   * computed HERE. `CustomerSyncPanel.test.tsx` proves the panel honours the
   * flag; only this pins that the page derives it from `can()` rather than
   * passing a constant.
   */
  it("derives the import gate from the caller's permission", async () => {
    listClientes.mockResolvedValue([row()]);
    countClientes.mockResolvedValue(1);
    // Only the WRITE gate flips. `can` also guards reading this page, so a
    // blanket `false` renders the permission notice and asserts nothing.
    can.mockImplementation((_user: unknown, action: string) => action !== "customers.write");

    try {
      render(await CustomersPage({ searchParams: Promise.resolve({}) }));

      expect(screen.getByTestId("sync-panel")).toHaveAttribute("data-can-sync", "false");
    } finally {
      // `mockClear()` in beforeEach does not reset an implementation, and a
      // leaked `false` would silently disarm every later render on this page.
      can.mockImplementation(() => true);
    }
  });

  /**
   * With no search term `filters` is `{}`, so the probe's
   * `{...filters, status: "all"}` is the SAME query the stats card already
   * ran. It used to fire anyway — a third COUNT, and the serial one rather
   * than the parallel one. Two is the floor here, not three.
   */
  it("reuses the card's count for the deactivated probe when nothing was searched", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockImplementation(countByStatus);

    render(await CustomersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: /desactivados/i })).toBeInTheDocument();
    expect(countClientes).toHaveBeenCalledTimes(2);
  });

  it("does not run the deactivated probe when the active list is not empty", async () => {
    listClientes.mockResolvedValue([row()]);
    countClientes.mockResolvedValue(1);
    render(await CustomersPage({ searchParams: Promise.resolve({}) }));

    // Two counts always run: the paginated one and the unfiltered one behind
    // the stats card. The probe this test guards would be a THIRD, and it is
    // the only count here that is conditional.
    expect(countClientes).toHaveBeenCalledTimes(2);
  });

  // The no-search branch's link was hardcoded and dropped `pageSize`, one
  // branch over from where WU14.2 fixed exactly that. Both links go through
  // `buildPageHref` now, and this is what keeps them from drifting apart
  // again.
  it("keeps pageSize on the no-search Ver desactivados link too", async () => {
    listClientes.mockResolvedValue([]);
    countClientes.mockImplementation(countByStatus);
    render(await CustomersPage({ searchParams: Promise.resolve({ pageSize: "50" }) }));

    const href = screen.getByRole("link", { name: /desactivados/i }).getAttribute("href")!;
    expect(href).toContain("pageSize=50");
    // `inactive`, not `all`: the link says "Ver desactivados" and now there is
    // a state that means exactly that. It used to open a mixed list because a
    // deactivated-only one could not be asked for.
    expect(href).toContain("status=inactive");
  });
});

/**
 * The row action moved into a kebab menu (table-redesign WU2). Two properties,
 * because the move can break either one on its own:
 *
 * - The TRIGGER is a real `<button>` and it is the whole cell. The 28px links
 *   this replaces on `/inventory` and `/service-orders` are deleted, not
 *   restyled, and the trigger carries the 44x44 hit target. No test in this
 *   repo asserts a button height (AGENTS.md), so the browser owns the 44
 *   itself; what a test CAN pin is that the cell stopped being a bare link.
 * - The ITEM that navigates is still a real link. Two of the three ways to put
 *   a navigation inside a base-ui menu quietly stop it being one:
 *   `DropdownMenuItem render={<Link/>}` emits `<a role="menuitem">`, and a
 *   plain `<Button onClick>` emits a `<button>` with no href at all. Either
 *   loses middle-click, "open in new tab", and the link's own announcement —
 *   none of which any styling test would notice.
 */
describe("CustomersPage — the row action is a kebab whose Ver item stays a link", () => {
  it("opens the kebab and renders Ver as a link to that customer, not a button", async () => {
    const user = userEvent.setup();
    render(await renderPage({}));

    // Named per row, not a bare "Acciones": the page renders one trigger per
    // customer, and an ambiguous accessible name makes `getByRole` throw as
    // soon as a second row exists.
    await user.click(screen.getByRole("button", { name: "Acciones de Retirado Perez" }));

    expect(await screen.findByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      "/customers/c1",
    );
    expect(screen.queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
  });

  it("leaves no bare Ver link in the row once the kebab owns the action", async () => {
    render(await renderPage({}));

    expect(screen.queryByRole("link", { name: "Ver" })).not.toBeInTheDocument();
  });
});

/**
 * table-column-sorting WU1. Nombre, Teléfono and Email are sortable;
 * `Vehículos` is NOT, and that is the spec's Conditional Vehicles Column
 * requirement doing its job — it renders a clickable header only if
 * verification proved the order both executes and reads sensibly. Re-measured
 * on the app's own database, ascending puts every vehicle-less customer
 * first, and 369 of 370 have none.
 */
describe("CustomersPage — column sorting", () => {
  beforeEach(() => {
    listClientes.mockClear();
    countClientes.mockClear();
  });

  it("renders name/phone/email headers as links carrying ?sort=&dir=asc by default", async () => {
    render(await renderPage({}));

    for (const [name, key] of [
      ["Nombre", "name"],
      ["Teléfono", "phone"],
      ["Email", "email"],
    ] as const) {
      const url = new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://localhost");
      expect(url.searchParams.get("sort")).toBe(key);
      expect(url.searchParams.get("dir")).toBe("asc");
    }

    // The negative half of the same requirement: a column whose ordering was
    // not proved sensible renders as text, not a link.
    expect(screen.getByRole("columnheader", { name: "Vehículos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Vehículos" })).not.toBeInTheDocument();
  });

  it("toggles the active column to desc, preserves search/status/pageSize, and drops page", async () => {
    render(
      await renderPage({ sort: "name", dir: "asc", search: "perez", status: "all", pageSize: "50", page: "3" }),
    );

    const url = new URL(screen.getByRole("link", { name: "Nombre" }).getAttribute("href")!, "http://localhost");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("search")).toBe("perez");
    expect(url.searchParams.get("status")).toBe("all");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("marks only the active header with aria-sort, matching the URL direction", async () => {
    render(await renderPage({ sort: "phone", dir: "desc" }));

    expect(screen.getByRole("link", { name: "Teléfono" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["Nombre", "Email"]) {
      const header = screen.getByRole("link", { name }).closest("th");
      expect(header).not.toHaveAttribute("aria-sort", "ascending");
      expect(header).not.toHaveAttribute("aria-sort", "descending");
    }
    // Vehículos is not a link, so it is reached as a plain column header.
    const vehiculos = screen.getByRole("columnheader", { name: "Vehículos" });
    expect(vehiculos).not.toHaveAttribute("aria-sort", "ascending");
    expect(vehiculos).not.toHaveAttribute("aria-sort", "descending");
  });

  /**
   * `buildSortHref` writes sort/dir; `buildPageHrefPattern` builds every
   * pagination link and did not. Sorting by Email and clicking page 2 dropped
   * them, so `parseClienteSort` returned undefined and page 2 came back in
   * `desc(createdAt)` — with the OFFSET computed against the OTHER ordering.
   * Rows repeat across the boundary and rows vanish. That is the failure the
   * tiebreaker exists to prevent, arriving through a different door.
   *
   * The same function already carries an R20 comment saying "every filter in
   * the URL has to survive paging", and a sibling test pinning `status` for
   * exactly this reason.
   */
  /**
   * The whole point of the work unit: the page parses the sort and HANDS IT
   * to the query. Dropping the third argument to `listClientes` left both
   * files green — the suite pinned the hrefs, the `aria-sort`, the pagination
   * carry and the negative case, and never the positive one.
   */
  it("hands the parsed sort to listClientes, which is the entire feature", async () => {
    render(await renderPage({ sort: "email", dir: "desc" }));

    expect(listClientes.mock.calls[0][2]).toEqual({ key: "email", dir: "desc" });
  });

  it("keeps the sort on every pagination link, like the status beside it", async () => {
    render(await renderPage({ sort: "name", dir: "asc" }));

    const pageHref = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .find((href) => href.includes("page="));

    expect(pageHref).toBeDefined();
    const url = new URL(pageHref!, "http://localhost");
    expect(url.searchParams.get("sort")).toBe("name");
    expect(url.searchParams.get("dir")).toBe("asc");
  });

  it("falls back to default order without throwing on a hand-typed garbage sort/dir", async () => {
    render(await renderPage({ sort: "garbage", dir: "sideways" }));

    // parseClienteSort discards it — listClientes' third argument stays undefined.
    expect(listClientes.mock.calls[0][2]).toBeUndefined();
    expect(screen.getByRole("link", { name: "Nombre" })).toBeInTheDocument();
  });
});

/**
 * The card answers "how many customers exist", so it counts the
 * whole table — not the page, and not the filter. Reading it off `total`
 * (the paginated count, which carries the search term and the status filter)
 * would make the headline number move every time staff typed in the search
 * box.
 */
describe("CustomersPage — the unfiltered total behind the stats card", () => {
  beforeEach(() => {
    listClientes.mockReset();
    countClientes.mockReset();
  });

  it("hands the panel a count taken with no search and no status filter", async () => {
    listClientes.mockResolvedValue([row()]);
    // Keyed on the filter, not on call order — `countByStatus` forty lines up
    // explains why an ordered chain is the wrong shape here, and this test
    // was contradicting it.
    countClientes.mockImplementation(async (filters: { status?: string }) =>
      filters.status === "all" ? 368 : 1,
    );

    render(await CustomersPage({ searchParams: Promise.resolve({ search: "perez", status: "inactive" }) }));

    expect(screen.getByTestId("sync-panel")).toHaveTextContent("368");
    // The filters the operator is looking at must not reach this count.
    expect(countClientes.mock.calls[1][0]).toEqual({ status: "all" });
  });
});
