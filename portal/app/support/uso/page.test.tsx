// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UsageDay, UsageReport } from "../../../src/usage/queries";
import Page from "./page";

let authed: boolean;
let report: UsageReport;
const usageReport = vi.fn();

vi.mock("../../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("../../../src/usage/queries", async (importActual) => ({
  ...(await importActual<typeof import("../../../src/usage/queries")>()),
  usageReport: (r: number) => usageReport(r),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const NEWEST = new Date("2026-11-08T03:00:00Z"); // Saturday 07/11 22:00 in Panama

/** 30 days ending Wed 11/11/2026; the last `missing` days not covered. Each covered day: 2 gestión + 3 técnicos. */
const days = (n: number, missing: number): UsageDay[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 11 - (n - 1 - i)));
    const covered = i < n - missing;
    return { day: d.toISOString().slice(0, 10), covered, gestion: covered ? 2 : 0, tecnico: covered ? 3 : 0 };
  });

const base = (): UsageReport => ({
  today: "2026-11-11",
  newest: NEWEST,
  newestAgeDays: 4,
  days: days(30, 0),
  screens: [
    { screen: "/kanban", gestion: 40, tecnico: 90 },
    { screen: "/agenda", gestion: 12, tecnico: 0 },
  ],
  catalog: [
    { pattern: "/kanban", label: "Órdenes en curso" },
    { pattern: "/agenda", label: "Agenda" },
    { pattern: "/builder", label: "Generar Catálogos" },
    { pattern: "/template-config", label: "Configuración de plantillas" },
  ],
  lastSeen: { "/builder": "2026-09-22" },
});

beforeEach(() => {
  authed = true;
  report = base();
  usageReport.mockReset().mockImplementation(async () => report);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NEWEST.getTime() + 60_000)); // fresh by default
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const open = async (params: Record<string, string> = {}) => render(await Page({ searchParams: Promise.resolve(params) }));
const section = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("/support/uso", () => {
  it("redirects to the support login without a session, and reads no data", async () => {
    authed = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /support/login");
    expect(usageReport).not.toHaveBeenCalled();
  });

  it("shows the title and the anonymity line", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Uso de la app" })).toBeTruthy();
    expect(screen.getByText("Conteos anónimos: por pantalla y grupo, nunca por persona.")).toBeTruthy();
  });

  it("with 4 of 30 days uncovered, says 26 de 30 and shows those days as missing, not zero", async () => {
    report.days = days(30, 4);
    const { container } = await open();
    expect(screen.getByText(/26 de 30 días con datos/)).toBeTruthy();
    expect(container.querySelectorAll("svg rect.nd")).toHaveLength(4);
    for (const nd of container.querySelectorAll("svg rect.nd")) expect(nd.getAttribute("fill")).toBe("url(#hatch)");
    const perDay = within(container.querySelector("details.days") as HTMLElement);
    expect(perDay.getAllByText("Sin datos todavía")).toHaveLength(4);
    // A covered day keeps its numbers; the 26 covered days are what the per-day rows add up to.
    expect(perDay.getAllByRole("row").filter((r) => r.textContent?.endsWith("5"))).toHaveLength(26);
    expect(screen.getByText("Sin datos todavía", { selector: ".legend .key" })).toBeTruthy();
  });

  it("totals are the per-screen totals of the covered days, split Gestión / Técnicos", async () => {
    await open();
    expect(screen.getByText("142 vistas")).toBeTruthy();
    expect(screen.getByText("52", { selector: ".sum b" })).toBeTruthy();
    expect(screen.getByText("90", { selector: ".sum b" })).toBeTruthy();
    expect(screen.getByText(/2 de 4 pantallas con visitas · 30 de 30 días con datos/)).toBeTruthy();
  });

  it("lists a catalog screen with no views under Sin visitas en el período", async () => {
    await open();
    const zero = within(section("Sin visitas en el período"));
    expect(zero.getByText("Configuración de plantillas")).toBeTruthy();
    expect(zero.getByText("Nunca en los últimos 90 días")).toBeTruthy();
    expect(zero.getByText("Generar Catálogos")).toBeTruthy();
    expect(zero.getByText("Última visita: 22/09")).toBeTruthy();
    expect(zero.queryByText("Agenda")).toBeNull();
  });

  it("shows views only by group (Gestión, Técnicos), never by role", async () => {
    await open();
    const table = within(section("Por pantalla")).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Pantalla", "Gestión", "Técnicos", "Total"]);
    const kanban = within(table).getByText("Órdenes en curso").closest("tr") as HTMLElement;
    expect([...kanban.querySelectorAll("td")].slice(1).map((td) => td.textContent)).toEqual(["40", "90", "130"]);
    expect(within(table).queryByText(/Administrador|Jefe de taller/)).toBeNull();
  });

  it("orders the screens from most to fewest views", async () => {
    await open();
    const rows = within(section("Por pantalla")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector(".scr")?.textContent)).toEqual(["Órdenes en curso", "Agenda"]);
  });

  it("shows the stale notice one millisecond past one day, with the Panama time of the last delivery", async () => {
    vi.setSystemTime(new Date(NEWEST.getTime() + 24 * 60 * 60_000 + 1));
    await open();
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("El último dato llegó hace 4 días");
    expect(notice.textContent).toContain("(sábado 07/11, 22:00)");
  });

  it("hides the stale notice at exactly one day", async () => {
    vi.setSystemTime(new Date(NEWEST.getTime() + 24 * 60 * 60_000));
    await open();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the empty state when no usage data ever arrived", async () => {
    report = { ...base(), newest: null, newestAgeDays: null, days: days(30, 30), screens: [] };
    await open();
    expect(screen.getByRole("heading", { name: "Todavía no llegaron datos de uso" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Período")).toBeNull();
  });

  it("reads the range from ?r=: 7 and 90, and 30 for anything else", async () => {
    for (const [r, want] of [["7", 7], ["90", 90], ["14", 30], ["junk", 30]] as const) {
      usageReport.mockClear();
      await open({ r });
      expect(usageReport).toHaveBeenCalledWith(want);
      expect(screen.getByRole("link", { name: `${want} días` }).getAttribute("aria-current")).toBe("true");
      cleanup();
    }
  });
});
