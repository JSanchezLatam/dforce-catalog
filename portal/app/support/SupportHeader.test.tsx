// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupportHeader } from "./SupportHeader";

let pathname: string;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  pathname = "/support";
});
afterEach(cleanup);

const nav = () => within(screen.getByRole("navigation", { name: "Secciones de soporte" }));
const tab = (name: RegExp) => nav().getByRole("link", { name });

describe("support header", () => {
  it("shows the brand and a Salir button", () => {
    render(<SupportHeader nuevo={2} />);
    expect(screen.getByText("Soporte — Dforce")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salir" })).toBeTruthy();
  });

  it("on /support/uso marks Uso as the current page and not Comentarios", () => {
    pathname = "/support/uso";
    render(<SupportHeader nuevo={2} />);
    expect(tab(/^Uso$/).getAttribute("aria-current")).toBe("page");
    expect(tab(/^Comentarios/).getAttribute("aria-current")).toBeNull();
  });

  it("on /support marks Comentarios as the current page and not Uso", () => {
    render(<SupportHeader nuevo={2} />);
    expect(tab(/^Comentarios/).getAttribute("aria-current")).toBe("page");
    expect(tab(/^Uso$/).getAttribute("aria-current")).toBeNull();
  });

  it("links the tabs to the inbox and the usage page", () => {
    render(<SupportHeader nuevo={2} />);
    expect(tab(/^Comentarios/).getAttribute("href")).toBe("/support");
    expect(tab(/^Uso$/).getAttribute("href")).toBe("/support/uso");
  });

  it("shows the count of Nuevo comments next to Comentarios, plural in its label", () => {
    render(<SupportHeader nuevo={2} />);
    const n = tab(/^Comentarios/).querySelector(".n");
    expect(n?.textContent).toBe("2");
    expect(n?.getAttribute("aria-label")).toBe("2 nuevos");
  });

  it("labels a single Nuevo comment in the singular", () => {
    render(<SupportHeader nuevo={1} />);
    expect(tab(/^Comentarios/).querySelector(".n")?.getAttribute("aria-label")).toBe("1 nuevo");
  });

  it("shows no count when there are no Nuevo comments", () => {
    render(<SupportHeader nuevo={0} />);
    expect(tab(/^Comentarios/).querySelector(".n")).toBeNull();
    expect(tab(/^Comentarios/).textContent).toBe("Comentarios");
  });

  it("gives each tab a 44x44 minimum target", () => {
    render(<SupportHeader nuevo={2} />);
    for (const t of nav().getAllByRole("link")) {
      expect(t.style.minHeight).toBe("2.75rem");
      expect(t.style.minWidth).toBe("2.75rem");
    }
  });
});
