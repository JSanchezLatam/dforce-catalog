/**
 * /access-log is a Server Component: it authorizes, reads, and renders. Queries
 * are mocked at the module boundary with their real row shape; the typed text
 * of an unknown login never reaches the page (`username: null`), which the e2e
 * pins against real SQL.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const q = vi.hoisted(() => ({ listAccessLog: vi.fn(), countAccessLog: vi.fn() }));
vi.mock("@/modules/auth/access-log-queries", () => q);

const listUsers = vi.hoisted(() => vi.fn());
vi.mock("@/modules/account/queries", () => ({ listUsers }));

const filters = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/AccessLogFilters", () => ({
  AccessLogFilters: (props: unknown) => {
    filters(props);
    return <div data-testid="access-log-filters" />;
  },
}));

import { formatDateTime } from "@/shared/datetime";

import AccessLogPage from "./page";

const admin = { id: "a", role: "administrador" };
const at = new Date("2026-11-18T15:26:00.000Z");

const open = async (params: Record<string, string> = {}) =>
  render(await AccessLogPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(admin);
  listUsers.mockResolvedValue([{ username: "mrodriguez" }, { username: "jsanchez" }]);
  q.countAccessLog.mockResolvedValue(3);
  q.listAccessLog.mockResolvedValue([
    { id: "1", at, username: "mrodriguez", ip: "192.168.1.23", outcome: "locked" },
    { id: "2", at, username: "jsanchez", ip: "181.197.4.20", outcome: "success" },
    { id: "3", at, username: null, ip: "45.12.0.9", outcome: "unknown_user" },
  ]);
});

describe("Registro de accesos", () => {
  it("refuses anyone who cannot manage users, and reads nothing", async () => {
    session.mockResolvedValue({ id: "t", role: "jefe_taller" });

    await open();

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(q.listAccessLog).not.toHaveBeenCalled();
  });

  it("lists each attempt with its time, user, result, detail and origin", async () => {
    await open();

    const table = within(screen.getByTestId("access-log-table"));
    expect(table.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Fecha y hora",
      "Usuario",
      "Resultado",
      "Detalle",
      "Origen",
    ]);
    const [locked, success] = table.getAllByRole("row").slice(1);
    expect(within(locked).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      formatDateTime(at),
      "mrodriguez",
      "Bloqueado",
      "Rechazado: acceso bloqueado",
      "Red del taller · 192.168.1.23",
    ]);
    expect(within(success).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      formatDateTime(at),
      "jsanchez",
      "Exitoso",
      "",
      "Internet · 181.197.4.20",
    ]);
  });

  it("names an unknown login only as Usuario desconocido", async () => {
    await open();

    const row = within(screen.getByTestId("access-log-table")).getAllByRole("row")[3];
    expect(within(row).getAllByRole("cell").map((c) => c.textContent).slice(1, 4)).toEqual([
      "Usuario desconocido",
      "Fallido",
      "Usuario desconocido",
    ]);
  });

  it("reads the filters from the address and offers the users as options", async () => {
    await open({ user: "jsanchez", result: "failed", days: "30", page: "2" });

    expect(q.listAccessLog).toHaveBeenCalledWith(
      { user: "jsanchez", result: "failed", days: 30 },
      { page: 2, offset: 25, limit: 25 },
    );
    expect(q.countAccessLog).toHaveBeenCalledWith({ user: "jsanchez", result: "failed", days: 30 });
    expect(filters).toHaveBeenCalledWith({
      selected: { user: "jsanchez", result: "failed", days: 30 },
      usernames: ["jsanchez", "mrodriguez"],
    });
  });

  it("keeps the filters on the page links", async () => {
    q.countAccessLog.mockResolvedValue(60);

    await open({ user: "jsanchez", result: "failed", days: "30" });

    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute(
      "href",
      "/access-log?user=jsanchez&result=failed&days=30&page=2",
    );
  });

  it("says when the period has no attempts", async () => {
    q.listAccessLog.mockResolvedValue([]);
    q.countAccessLog.mockResolvedValue(0);

    await open();

    expect(screen.getByText("No hay intentos de inicio de sesión con estos filtros.")).toBeInTheDocument();
    expect(screen.queryByTestId("access-log-table")).not.toBeInTheDocument();
  });
});
