import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, secondFactorSession, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "pending-token" as string | undefined },
  secondFactorSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/auth/second-factor", () => ({ secondFactorSession }));
vi.mock("@/modules/auth/SecondFactorForm", () => ({ SecondFactorForm: () => <form aria-label="código" /> }));
vi.mock("@/modules/auth/LoginThemeToggle", () => ({ LoginThemeToggle: () => null }));

import TwoFactorPage from "./page";

const session = (pending: "verify" | "enroll" | null, role = "administrador") => ({
  userId: "u1",
  username: "mrodriguez",
  role,
  pending,
  createdAt: new Date(),
});

beforeEach(() => {
  cookieValue.current = "pending-token";
  secondFactorSession.mockReset();
  redirect.mockClear();
});

describe("TwoFactorPage", () => {
  it("greets the user of a pending session and shows the code form", async () => {
    secondFactorSession.mockResolvedValue(session("verify"));

    render(await TwoFactorPage());

    expect(secondFactorSession).toHaveBeenCalledWith("pending-token");
    expect(screen.getByRole("heading", { level: 1, name: "Verificación en dos pasos" })).toBeInTheDocument();
    expect(screen.getByText("mrodriguez").closest("p")).toHaveTextContent("Hola, mrodriguez");
    expect(screen.getByRole("form", { name: "código" })).toBeInTheDocument();
  });

  it("sends a request with no cookie to the login", async () => {
    cookieValue.current = undefined;

    await expect(TwoFactorPage()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(secondFactorSession).not.toHaveBeenCalled();
  });

  it.each([
    ["no usable session", null],
    ["a session pending something else", session("enroll")],
  ])("sends %s to the login", async (_label, found) => {
    secondFactorSession.mockResolvedValue(found);

    await expect(TwoFactorPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it.each([
    ["administrador", "/inventory"],
    ["pantalla", "/tablero/clientes"],
  ])("sends a full %s session to its landing %s", async (role, path) => {
    secondFactorSession.mockResolvedValue(session(null, role));

    await expect(TwoFactorPage()).rejects.toThrow(`NEXT_REDIRECT ${path}`);
  });
});
