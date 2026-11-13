// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackDetail, FeedbackListRow } from "../../src/support/queries";
import Page from "./page";

let authed: boolean;
let rows: FeedbackListRow[];
let counts: { nuevo: number; leido: number; resuelto: number };
const listFeedback = vi.fn();
const statusCounts = vi.fn();
const markRead = vi.fn();
const getFeedback = vi.fn();

vi.mock("../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("../../src/support/queries", async (importActual) => ({
  ...(await importActual<typeof import("../../src/support/queries")>()),
  listFeedback: (f: unknown) => listFeedback(f),
  statusCounts: () => statusCounts(),
  markRead: (id: string) => markRead(id),
  getFeedback: (id: string) => getFeedback(id),
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
  markRead.mockReset().mockResolvedValue(undefined);
  getFeedback.mockReset().mockResolvedValue(undefined);
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

  // The support header and Salir moved to the layout: layout.test.tsx asserts them.
  it("shows the Comentarios del taller title", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Comentarios del taller" })).toBeTruthy();
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

  // A plain anchor: never prefetched (opening marks read), and a full load refreshes the layout's Nuevo counter.
  it("links each row to ?id=… with a plain anchor, not next/link, keeping the active filters", async () => {
    rows = [row({ id: "a" }), row({ id: "b" })];
    await open({ status: "nuevo" });
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("id="));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/support?id=a&status=nuevo", "/support?id=b&status=nuevo"]);
    expect(links.map((l) => l.hasAttribute("data-prefetch"))).toEqual([false, false]); // the next/link mock adds it
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

const ID = "11111111-1111-4111-8111-111111111111";
const detail = (over: Partial<FeedbackDetail> = {}): FeedbackDetail => ({
  ...row({ id: ID, status: "leido" }),
  text: "El botón Guardar no responde\ny pierdo lo escrito.",
  internalNote: "revisar el martes",
  ...over,
});

describe("/support detail pane", () => {
  it("without ?id= marks nothing, reads no detail and invites to pick one", async () => {
    await open();
    expect(markRead).not.toHaveBeenCalled();
    expect(getFeedback).not.toHaveBeenCalled();
    expect(screen.getByText("Elegí un comentario de la lista.")).toBeTruthy();
  });

  it("without ?id= but with filters still marks nothing", async () => {
    await open({ status: "nuevo" });
    expect(markRead).not.toHaveBeenCalled();
  });

  it("with ?id= marks that row read BEFORE reading it back, so the pane shows the new status", async () => {
    const order: string[] = [];
    markRead.mockImplementation(async () => void order.push("mark"));
    getFeedback.mockImplementation(async () => (order.push("get"), detail()));
    await open({ id: ID });
    expect(markRead).toHaveBeenCalledWith(ID);
    expect(getFeedback).toHaveBeenCalledWith(ID);
    expect(order).toEqual(["mark", "get"]);
  });

  it("marks and counts in that order too: the chips must see the row already read", async () => {
    const order: string[] = [];
    markRead.mockImplementation(async () => void order.push("mark"));
    statusCounts.mockImplementation(async () => (order.push("counts"), counts));
    getFeedback.mockResolvedValue(detail());
    await open({ id: ID });
    expect(order).toEqual(["mark", "counts"]);
  });

  it("shows the full text, author and role, screen, both times, the delay flag and the status", async () => {
    getFeedback.mockResolvedValue(detail());
    await open({ id: ID });
    const pane = screen.getByRole("complementary", { name: "Detalle del comentario" });
    expect(within(pane).getByRole("heading", { name: "Algo no funciona" })).toBeTruthy();
    expect(pane.querySelector(".chip")?.textContent).toBe("Leído");
    expect(within(pane).getByText(/El botón Guardar no responde\s+y pierdo lo escrito\./)).toBeTruthy();
    expect(within(pane).getByText("jperez · Técnico")).toBeTruthy();
    expect(within(pane).getByText("Orden #1234 — Detalle")).toBeTruthy();
    expect(within(pane).getByText("09/11/2026 09:12")).toBeTruthy();
    expect(within(pane).getByText(/09\/11\/2026 14:47/)).toBeTruthy();
    expect(within(pane).getByText("Llegó con demora: estuvo en cola sin internet")).toBeTruthy();
  });

  it("shows both times but no delay flag for a prompt comment", async () => {
    getFeedback.mockResolvedValue(detail({ receivedAt: new Date("2026-11-09T14:22:00Z") }));
    await open({ id: ID });
    const pane = within(screen.getByRole("complementary", { name: "Detalle del comentario" }));
    expect(pane.getByText("09/11/2026 09:22")).toBeTruthy();
    expect(pane.queryByText(/Llegó con demora/)).toBeNull();
  });

  it("hands the editor only serializable props: id, status and the saved note", async () => {
    getFeedback.mockResolvedValue(detail({ status: "resuelto" }));
    await open({ id: ID });
    expect((screen.getByLabelText("Nota interna") as HTMLTextAreaElement).value).toBe("revisar el martes");
    expect(screen.getByRole("button", { name: "Resuelto" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Volver goes back to the list keeping the current filters", async () => {
    getFeedback.mockResolvedValue(detail());
    await open({ id: ID, status: "nuevo", role: "tecnico" });
    expect(screen.getByRole("link", { name: "Volver" }).getAttribute("href")).toBe("/support?status=nuevo&role=tecnico");
  });

  it("Volver with no filters is plain /support", async () => {
    getFeedback.mockResolvedValue(detail());
    await open({ id: ID });
    expect(screen.getByRole("link", { name: "Volver" }).getAttribute("href")).toBe("/support");
  });

  it("an id that is not a uuid shows not-found without touching the database for it", async () => {
    await open({ id: "no-es-uuid" });
    expect(markRead).not.toHaveBeenCalled();
    expect(getFeedback).not.toHaveBeenCalled();
    expect(screen.getByText("No encontramos ese comentario.")).toBeTruthy();
  });

  it("a uuid with no row shows not-found, not a crash, with Volver", async () => {
    getFeedback.mockResolvedValue(undefined);
    await open({ id: ID, status: "nuevo" });
    expect(screen.getByText("No encontramos ese comentario.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver" }).getAttribute("href")).toBe("/support?status=nuevo");
  });

  it("a repeated ?id= is ignored like any other malformed value", async () => {
    await open({ id: [ID, ID] as unknown as string });
    expect(markRead).not.toHaveBeenCalled();
  });

  it("without a session marks nothing", async () => {
    authed = false;
    await expect(Page({ searchParams: Promise.resolve({ id: ID }) })).rejects.toThrow("REDIRECT");
    expect(markRead).not.toHaveBeenCalled();
  });
});
