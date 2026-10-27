/**
 * /agenda is a Server Component. WU1 ships it as a stub: authorize, then an empty heading.
 * Later work units add the data reads and extend this file.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: session }));

import AgendaPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("AgendaPage access", () => {
  it("Técnico is denied: tecnico sees the denial screen titled Agenda", async () => {
    session.mockResolvedValue({ id: "t", role: "tecnico" });

    render(await AgendaPage());

    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
  });

  it("Pantalla never sees the agenda: invoked directly it is denied too", async () => {
    session.mockResolvedValue({ id: "p", role: "pantalla" });

    render(await AgendaPage());

    expect(screen.getByText("No tenés permiso para ver esta página")).toBeInTheDocument();
  });

  it.each([["administrador"], ["jefe_taller"]])("%s gets the page, not the denial", async (role) => {
    session.mockResolvedValue({ id: "x", role });

    render(await AgendaPage());

    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.queryByText("No tenés permiso para ver esta página")).not.toBeInTheDocument();
  });
});
