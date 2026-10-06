/**
 * Audit #11/#14 on /inventory: the greeting and the stats card sat ABOVE the
 * title, so on a phone the operator scrolled past a "Hola, Administrador" row
 * to learn which page this was. The title now leads, the greeting is a desktop
 * row, and the stats card stays on a phone only where it holds an action
 * (the administrador's "Sincronizar inventario"). Unlike `page.test.tsx`, the
 * header and the sync button are the REAL components here: a stub header would
 * test the stub's order.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ role: "administrador" as "administrador" | "tecnico" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: session.role })),
}));
vi.mock("@/modules/auth/policy", () => ({
  can: (user: { role: string }, action: string) => (action === "sync.manual" ? user.role === "administrador" : true),
}));
vi.mock("@/modules/inventory-view/InventoryFilters", () => ({ InventoryFilters: () => null }));

const listInventory = vi.hoisted(() => vi.fn());
const countAllProducts = vi.hoisted(() => vi.fn(async () => 712));
const hasAnyProducts = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/modules/inventory-view/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/inventory-view/queries")>();
  return {
    ...actual,
    listInventory,
    listCategoryL1Options: vi.fn(async () => []),
    listCategoryL2Options: vi.fn(async () => []),
    countAllProducts,
    hasAnyProducts,
  };
});

import { ToastProvider } from "@/shared/ui/ToastProvider";
import InventoryPage from "./page";

async function renderPage() {
  render(<ToastProvider>{await InventoryPage({ searchParams: Promise.resolve({}) })}</ToastProvider>);
}

function statsCard() {
  const card = screen.getByText("Total de productos").closest("[data-slot='card']");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe("InventoryPage — header (audit #11, #14)", () => {
  beforeEach(() => {
    // `ManualSyncButton` polls its status on mount; an unreachable status is its "no run yet".
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
    listInventory.mockResolvedValue({ items: [], total: 0 });
    countAllProducts.mockResolvedValue(712);
    hasAnyProducts.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    session.role = "administrador";
  });

  it("renders the title above the greeting, and the greeting is a desktop-only row", async () => {
    await renderPage();

    const title = screen.getByRole("heading", { level: 1, name: "Inventario" });
    const greeting = screen.getByText("Hola, Administrador");
    expect(title.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(greeting.closest(".hidden")).toHaveClass("hidden", "md:flex");
  });

  it("keeps the title above the greeting when the inventory is empty", async () => {
    hasAnyProducts.mockResolvedValue(false);
    await renderPage();

    const title = screen.getByRole("heading", { level: 1, name: "Inventario" });
    const greeting = screen.getByText("Hola, Administrador");
    expect(title.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("administrador keeps the stats card with the sync action, visible on a phone, and no duplicate subtitle", async () => {
    await renderPage();

    const card = statsCard();
    expect(within(card).getByRole("button", { name: "Sincronizar inventario" })).toBeInTheDocument();
    expect(within(card).getByText("712")).toBeInTheDocument();
    expect(card).not.toHaveClass("hidden");
    expect(screen.queryByText("712 productos sincronizados desde Interfuerza")).not.toBeInTheDocument();
  });

  it("técnico sees a phone-only subtitle, and the stats card only from md up", async () => {
    session.role = "tecnico";
    await renderPage();

    const subtitle = screen.getByText("712 productos sincronizados desde Interfuerza");
    expect(subtitle).toHaveClass("md:hidden");
    expect(statsCard()).toHaveClass("hidden", "md:block");
    expect(screen.queryByRole("button", { name: "Sincronizar inventario" })).not.toBeInTheDocument();
  });

  it("técnico's subtitle uses the singular for one product", async () => {
    session.role = "tecnico";
    countAllProducts.mockResolvedValue(1);
    await renderPage();
    expect(screen.getByText("1 producto sincronizado desde Interfuerza")).toBeInTheDocument();
  });

  it("técnico has no subtitle on an empty inventory (it would claim '0 productos sincronizados')", async () => {
    session.role = "tecnico";
    countAllProducts.mockResolvedValue(0);
    hasAnyProducts.mockResolvedValue(false);
    await renderPage();

    expect(screen.getByText(/El inventario está vacío/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ productos? sincronizados? desde Interfuerza/)).not.toBeInTheDocument();
  });
});
