/**
 * No list-level test existed for this page before table-column-sorting WU3.
 * Scope stays to sorting (mirrors customers/page.test.tsx's "column sorting"
 * describe block, `getAllByRole("link")` idiom from `page.test.tsx:130-142`),
 * but this file also becomes the first runtime coverage this page has at all.
 */
import { render, screen } from "@testing-library/react";
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

function orden(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    clienteId: "c1",
    vehiculoId: "v1",
    status: "open",
    categoria: "revisado",
    description: null,
    appointmentAt: null,
    completedAt: null,
    hallazgos: null,
    recomendaciones: null,
    observaciones: null,
    createdBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
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
    expect(screen.getByRole("columnheader", { name: "Descripción" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Descripción" })).not.toBeInTheDocument();
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

    const pageHref = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .find((href) => href.includes("page="));

    expect(pageHref).toBeDefined();
    const url = new URL(pageHref!, "http://localhost");
    expect(url.searchParams.get("sort")).toBe("id");
    expect(url.searchParams.get("dir")).toBe("asc");
    expect(url.searchParams.get("status")).toBe("open");
  });

  it("falls back to default order without throwing on a hand-typed garbage sort/dir", async () => {
    render(await renderPage({ sort: "garbage", dir: "sideways" }));

    expect(listOrdenesServicio.mock.calls[0][2]).toBeUndefined();
    expect(screen.getByRole("link", { name: "ID" })).toBeInTheDocument();
  });
});
