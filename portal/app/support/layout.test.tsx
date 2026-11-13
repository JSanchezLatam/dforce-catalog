// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Layout from "./layout";

let authed: boolean;
let pathname: string;
const statusCounts = vi.fn();

vi.mock("../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("../../src/support/queries", () => ({ statusCounts: () => statusCounts() }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  authed = true;
  pathname = "/support";
  statusCounts.mockReset().mockResolvedValue({ nuevo: 2, leido: 5, resuelto: 1 });
});
afterEach(cleanup);

const open = async () => render(await Layout({ children: <p>contenido</p> }));
const nav = () => within(screen.getByRole("navigation", { name: "Secciones de soporte" }));
const tab = (name: RegExp) => nav().getByRole("link", { name });

describe("support layout", () => {
  it("without a session (the login page) renders only the page: no nav, no header, no query", async () => {
    authed = false;
    await open();
    expect(screen.getByText("contenido")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salir" })).toBeNull();
    expect(statusCounts).not.toHaveBeenCalled();
  });

  it("shows the support header and a Salir button around the page", async () => {
    await open();
    expect(screen.getByText("Soporte — Dforce")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salir" })).toBeTruthy();
    expect(screen.getByText("contenido")).toBeTruthy();
  });

  it("on /support/uso marks Uso as the current page and not Comentarios", async () => {
    pathname = "/support/uso";
    await open();
    expect(tab(/^Uso$/).getAttribute("aria-current")).toBe("page");
    expect(tab(/^Comentarios/).getAttribute("aria-current")).toBeNull();
  });

  it("on /support marks Comentarios as the current page and not Uso", async () => {
    await open();
    expect(tab(/^Comentarios/).getAttribute("aria-current")).toBe("page");
    expect(tab(/^Uso$/).getAttribute("aria-current")).toBeNull();
  });

  it("links the tabs to the inbox and the usage page", async () => {
    await open();
    expect(tab(/^Comentarios/).getAttribute("href")).toBe("/support");
    expect(tab(/^Uso$/).getAttribute("href")).toBe("/support/uso");
  });

  it("shows the count of Nuevo comments next to Comentarios", async () => {
    await open();
    expect(tab(/^Comentarios/).querySelector(".n")?.textContent).toBe("2");
  });

  it("shows no count when there are no Nuevo comments", async () => {
    statusCounts.mockResolvedValue({ nuevo: 0, leido: 5, resuelto: 1 });
    await open();
    expect(tab(/^Comentarios/).querySelector(".n")).toBeNull();
    expect(tab(/^Comentarios/).textContent).toBe("Comentarios");
  });

  it("gives each tab a 44x44 minimum target", async () => {
    await open();
    for (const t of nav().getAllByRole("link")) {
      expect(t.style.minHeight).toBe("2.75rem");
      expect(t.style.minWidth).toBe("2.75rem");
    }
  });
});
