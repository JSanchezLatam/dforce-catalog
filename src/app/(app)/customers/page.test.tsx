/**
 * R20 — written because GGA found `buildPageHref` dropping `includeInactive`:
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

function renderPage(params: Record<string, string>) {
  listClientes.mockResolvedValue([row({ deactivatedAt: new Date("2026-09-01") })]);
  // More than one page, so the pagination links actually render.
  countClientes.mockResolvedValue(40);
  return CustomersPage({ searchParams: Promise.resolve(params) });
}

describe("CustomersPage — deactivated customers (R20)", () => {
  // Without this, `mock.calls[0]` is the FIRST call of the whole file, not of
  // the current test - which silently asserted the previous test's filters.
  beforeEach(() => {
    listClientes.mockClear();
    countClientes.mockClear();
  });

  it("asks for active customers only by default", async () => {
    render(await renderPage({}));
    expect(listClientes.mock.calls[0][0].includeInactive).toBeUndefined();
  });

  it("passes includeInactive through when the URL asks for it", async () => {
    render(await renderPage({ includeInactive: "1" }));
    expect(listClientes.mock.calls[0][0].includeInactive).toBe(true);
    expect(countClientes.mock.calls[0][0].includeInactive).toBe(true);
  });

  it("reads =1 exactly, so includeInactive=0 stays off", async () => {
    render(await renderPage({ includeInactive: "0" }));
    expect(listClientes.mock.calls[0][0].includeInactive).toBeUndefined();
  });

  // THE BUG. Every pagination link has to carry the flag; without it page 2
  // reads as "the deactivated records disappeared" rather than "the filter
  // reset itself".
  it("keeps includeInactive on every pagination link", async () => {
    render(await renderPage({ includeInactive: "1" }));

    const pageLinks = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("page="));

    expect(pageLinks.length).toBeGreaterThan(0);
    for (const href of pageLinks) {
      expect(href).toContain("includeInactive=1");
    }
  });

  it("keeps the search term on pagination links too, alongside the flag", async () => {
    render(await renderPage({ includeInactive: "1", search: "perez" }));

    const href = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => h.includes("page="));

    expect(href).toContain("search=perez");
    expect(href).toContain("includeInactive=1");
  });

  it("marks a listed deactivated customer instead of mixing it in silently", async () => {
    render(await renderPage({ includeInactive: "1" }));
    expect(screen.getByText("Desactivado")).toBeInTheDocument();
  });
});
