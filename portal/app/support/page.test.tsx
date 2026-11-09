// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackListRow } from "../../src/support/queries";
import Page from "./page";

let authed: boolean;
let rows: FeedbackListRow[];
let counts: { nuevo: number; leido: number; resuelto: number };
const listFeedback = vi.fn();
const statusCounts = vi.fn();

vi.mock("../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("../../src/support/queries", async (importActual) => ({
  ...(await importActual<typeof import("../../src/support/queries")>()),
  listFeedback: (f: unknown) => listFeedback(f),
  statusCounts: () => statusCounts(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
// next/link does not render `prefetch` to the DOM; surface it so a test can see it.
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: boolean; children: React.ReactNode }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<FeedbackListRow>): FeedbackListRow => ({
  id: "id-1",
  username: "jperez",
  role: "tecnico",
  category: "bug",
  status: "nuevo",
  screenLabel: "Orden #1234 — Detalle",
  createdAt: new Date("2026-11-09T14:12:00Z"), // 09:12 in Panama
  receivedAt: new Date("2026-11-09T19:47:00Z"), // 14:47 in Panama
  ...over,
});

beforeEach(() => {
  authed = true;
  rows = [row({})];
  counts = { nuevo: 2, leido: 2, resuelto: 1 };
  listFeedback.mockReset().mockImplementation(async () => rows);
  statusCounts.mockReset().mockImplementation(async () => counts);
});
afterEach(cleanup);

const open = async (params: Record<string, string> = {}) => render(await Page({ searchParams: Promise.resolve(params) }));

describe("/support inbox list", () => {
  it("redirects to the login page without a session, and reads no data", async () => {
    authed = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /support/login");
    expect(listFeedback).not.toHaveBeenCalled();
    expect(statusCounts).not.toHaveBeenCalled();
  });

  it("shows the support header, the Comentarios del taller title and a Salir button", async () => {
    await open();
    expect(screen.getByText("Soporte — Dforce")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comentarios del taller" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salir" })).toBeTruthy();
  });

  it("shows category, status chip, author and role, screen, received time and the unread marker", async () => {
    await open();
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Algo no funciona")).toBeTruthy();
    expect(within(item).getByText("Nuevo")).toBeTruthy();
    expect(within(item).getByText(/jperez · Técnico/)).toBeTruthy();
    expect(within(item).getByText(/Orden #1234 — Detalle/)).toBeTruthy();
    expect(within(item).getByText("Recibido 09/11/2026 14:47")).toBeTruthy();
    expect(item.querySelector(".unread")).toBeTruthy();
  });

  it("flags a comment received more than 10 minutes late, with the time it was written", async () => {
    await open();
    expect(screen.getByText("Llegó con demora · escrito 09/11/2026 09:12")).toBeTruthy();
  });

  it("does not flag a prompt one, nor mark a Leído one unread", async () => {
    rows = [row({ status: "leido", receivedAt: new Date("2026-11-09T14:22:00Z") })]; // exactly 10:00
    await open();
    expect(screen.queryByText(/Llegó con demora/)).toBeNull();
    expect(screen.getByText("Recibido 09/11/2026 09:22")).toBeTruthy();
    expect(screen.getByText("Leído")).toBeTruthy();
    expect(screen.getByRole("listitem").querySelector(".unread")).toBeNull();
  });

  it("keeps the order the query returns (newest first is the query's job)", async () => {
    rows = [row({ id: "a", username: "primero" }), row({ id: "b", username: "segundo" })];
    await open();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("primero"), expect.stringContaining("segundo")]);
  });

  it("links each row to ?id=… with prefetch off, keeping the active filters", async () => {
    rows = [row({ id: "a" }), row({ id: "b" })];
    await open({ status: "nuevo" });
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("id="));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/support?id=a&status=nuevo", "/support?id=b&status=nuevo"]);
    expect(links.map((l) => l.getAttribute("data-prefetch"))).toEqual(["false", "false"]);
  });

  it("passes only the parsed filters to the query", async () => {
    await open({ status: "nuevo", category: "bug", role: "tecnico", evil: "x" });
    expect(listFeedback).toHaveBeenCalledWith({ status: "nuevo", category: "bug", role: "tecnico" });
  });

  it("shows the status counts: Todos (5), Nuevo (2), Leído (2), Resuelto (1)", async () => {
    await open();
    const group = screen.getByRole("group", { name: "Filtrar por estado" });
    expect(within(group).getAllByRole("link").map((l) => l.textContent)).toEqual(["Todos (5)", "Nuevo (2)", "Leído (2)", "Resuelto (1)"]);
  });

  it("status links keep the other filters and mark the current one", async () => {
    await open({ status: "leido", role: "tecnico" });
    const group = screen.getByRole("group", { name: "Filtrar por estado" });
    expect(within(group).getByRole("link", { name: "Nuevo (2)" }).getAttribute("href")).toBe("/support?status=nuevo&role=tecnico");
    expect(within(group).getByRole("link", { name: "Todos (5)" }).getAttribute("href")).toBe("/support?role=tecnico");
    expect(within(group).getByRole("link", { name: "Leído (2)" }).getAttribute("aria-current")).toBe("true");
    expect(within(group).getByRole("link", { name: "Nuevo (2)" }).getAttribute("aria-current")).toBeNull();
  });

  it("offers the three categories and only the three real roles, with the current one selected", async () => {
    await open({ category: "idea", role: "jefe_taller" });
    const cat = screen.getByLabelText("Tipo") as HTMLSelectElement;
    const role = screen.getByLabelText("Rol") as HTMLSelectElement;
    expect([...cat.options].map((o) => o.textContent)).toEqual(["Todos", "Algo no funciona", "Idea o mejora", "Otra cosa"]);
    expect([...role.options].map((o) => o.textContent)).toEqual(["Todos", "Técnico", "Jefe de taller", "Administrador"]);
    expect(cat.value).toBe("idea");
    expect(role.value).toBe("jefe_taller");
  });

  it("the select form is a GET to /support and carries the current status", async () => {
    const { container } = await open({ status: "nuevo" });
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/support");
    expect((form.querySelector('input[name="status"]') as HTMLInputElement).value).toBe("nuevo");
    expect(screen.getByRole("button", { name: "Filtrar" })).toBeTruthy();
  });

  it("with no comments stored: empty state, and no filters", async () => {
    rows = [];
    counts = { nuevo: 0, leido: 0, resuelto: 0 };
    await open();
    expect(screen.getByText("No hay comentarios")).toBeTruthy();
    expect(screen.getByText("Cuando alguien del taller envíe uno, aparece acá.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filtrar por estado" })).toBeNull();
    expect(screen.queryByLabelText("Tipo")).toBeNull();
  });

  it("with stored comments but none matching: message, filters still there, and Limpiar filtros resets to /support", async () => {
    rows = [];
    await open({ status: "resuelto", role: "tecnico" });
    expect(screen.getByText("Ningún comentario coincide con los filtros")).toBeTruthy();
    expect(screen.queryByText("No hay comentarios")).toBeNull();
    expect(screen.getByRole("group", { name: "Filtrar por estado" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Limpiar filtros" }).getAttribute("href")).toBe("/support");
  });
});
