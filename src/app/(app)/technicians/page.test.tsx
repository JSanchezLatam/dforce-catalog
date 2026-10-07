/**
 * The roster page is a Server Component, so what it hands the client roster is
 * the RSC boundary: plain data only (no `Date`, no function), and the link
 * capability decided HERE from the real policy, not trusted from a prop.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

const listRoster = vi.hoisted(() => vi.fn());
const listTecnicoLogins = vi.hoisted(() => vi.fn());
vi.mock("@/modules/technicians/queries", () => ({ listRoster, listTecnicoLogins }));

// Renders EVERY prop as JSON: the page's contract with the client component is
// the serialised shape, and a stub that rendered nothing would let a hardcoded
// `canLink` or a raw `Date` through.
vi.mock("@/modules/technicians/TechnicianRoster", () => ({
  TechnicianRoster: (props: unknown) => <pre data-testid="roster">{JSON.stringify(props)}</pre>,
}));

import TechniciansPage from "./page";

const DEACTIVATED = new Date("2026-09-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  listRoster.mockResolvedValue([
    { id: "t-1", nombre: "Luis", userId: null, username: null, deactivatedAt: null, createdAt: DEACTIVATED },
    { id: "t-2", nombre: "Zoe", userId: "u-1", username: "zoe", deactivatedAt: DEACTIVATED, createdAt: DEACTIVATED },
  ]);
  listTecnicoLogins.mockResolvedValue([{ id: "u-2", username: "beto" }]);
});

const props = () => JSON.parse(screen.getByTestId("roster").textContent!);

describe("TechniciansPage", () => {
  it("refuses a técnico with the denial screen and reads nothing", async () => {
    session.mockResolvedValue({ id: "u", role: "tecnico" });

    render(await TechniciansPage());

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
    expect(listRoster).not.toHaveBeenCalled();
    expect(listTecnicoLogins).not.toHaveBeenCalled();
  });

  it("gives a jefe the roster without the link capability and without reading logins", async () => {
    session.mockResolvedValue({ id: "j", role: "jefe_taller" });

    render(await TechniciansPage());

    expect(screen.getByRole("heading", { name: "Técnicos" })).toBeInTheDocument();
    expect(props().canLink).toBe(false);
    expect(props().logins).toEqual([]);
    expect(listTecnicoLogins).not.toHaveBeenCalled();
  });

  it("gives an administrador the link capability and the linkable logins", async () => {
    session.mockResolvedValue({ id: "a", role: "administrador" });

    render(await TechniciansPage());

    expect(props().canLink).toBe(true);
    expect(props().logins).toEqual([{ id: "u-2", username: "beto" }]);
  });

  it("serialises deactivatedAt to an ISO string across the RSC boundary", async () => {
    session.mockResolvedValue({ id: "a", role: "administrador" });

    render(await TechniciansPage());

    expect(props().technicians.map((t: { deactivatedAt: string | null }) => t.deactivatedAt)).toEqual([null, DEACTIVATED.toISOString()]);
  });

  it("hands the client exactly the columns it renders: createdAt stays on the server", async () => {
    session.mockResolvedValue({ id: "a", role: "administrador" });

    render(await TechniciansPage());

    expect(Object.keys(props().technicians[0]).sort()).toEqual(["deactivatedAt", "id", "nombre", "userId", "username"]);
  });
});
