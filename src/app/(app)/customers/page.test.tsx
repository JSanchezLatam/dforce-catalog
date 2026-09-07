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
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));
vi.mock("@/modules/customers/CustomerFormTrigger", () => ({ CustomerFormTrigger: () => null }));
// Irrelevant to R20 (this file's subject) and requires a ToastProvider this
// unit render doesn't set up — same reason CustomerFormTrigger is stubbed.
vi.mock("@/modules/customer-import/CustomerSyncPanel", () => ({
  // Renders the prop instead of `null`: the stats card lives inside the panel,
  // so the only part of it this page owns is the number it hands over.
  CustomerSyncPanel: ({ total }: { total: number }) => <div data-testid="sync-panel">{total}</div>,
}));
vi.mock("@/modules/customers/CustomerFilters", () => ({ CustomerFilters: () => null }));

const listClientes = vi.hoisted(() => vi.fn());
const countClientes = vi.hoisted(() => vi.fn());
vi.mock("@/modules/customers/queries", () => ({ listClientes, countClientes }));

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
    // Positional: only the phone column can be the empty one here, since the
    // row seeds a real email and a real plate.
    expect(cells).not.toContain("");
    expect(cells).toContain("—");
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
 * The row action was restyled from a hand-copied class string onto the shared
 * button vocabulary. Two of the three ways to do that quietly stop it being a
 * link: base-ui's `Button render={<Link/>}` with `nativeButton={false}` emits
 * `<a role="button">`, and a plain `<Button onClick>` emits a `<button>` with
 * no href at all. Either one loses middle-click, "open in new tab", and the
 * link's own announcement — none of which any styling test would notice.
 */
describe("CustomersPage — the row action stays a link", () => {
  it("renders Ver as a link to that customer, not a button", async () => {
    render(await renderPage({}));

    expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute("href", "/customers/c1");
    expect(screen.queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
  });
});

/**
 * The card answers "how many customers do I have synced", so it counts the
 * whole table — not the page, and not the filter. Reading it off `total`
 * (the paginated count, which carries the search term and the status filter)
 * would make the headline number move every time staff typed in the search
 * box.
 */
describe("CustomersPage — the synced-customer total behind the stats card", () => {
  beforeEach(() => {
    listClientes.mockReset();
    countClientes.mockReset();
  });

  it("hands the panel a count taken with no search and no status filter", async () => {
    listClientes.mockResolvedValue([row()]);
    // In call order: the filtered count paging uses, then the unfiltered one.
    countClientes.mockResolvedValueOnce(1).mockResolvedValueOnce(368);

    render(await CustomersPage({ searchParams: Promise.resolve({ search: "perez", status: "inactive" }) }));

    expect(screen.getByTestId("sync-panel")).toHaveTextContent("368");
    // The filters the operator is looking at must not reach this count.
    expect(countClientes.mock.calls[1][0]).toEqual({ status: "all" });
  });
});
