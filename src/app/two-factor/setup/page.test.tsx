import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, secondFactorSession, twoFactorAvailable, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "enroll-token" as string | undefined },
  secondFactorSession: vi.fn(),
  twoFactorAvailable: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/auth/second-factor", () => ({ secondFactorSession }));
vi.mock("@/modules/auth/enrolment", () => ({ twoFactorAvailable }));
vi.mock("@/modules/auth/TwoFactorSetup", () => ({
  TwoFactorSetup: ({ roleLabel, available }: { roleLabel: string; available: boolean }) => (
    <p data-testid="setup">{`${roleLabel}|${available}`}</p>
  ),
}));
vi.mock("@/modules/auth/LoginThemeToggle", () => ({ LoginThemeToggle: () => null }));

import TwoFactorSetupPage from "./page";

const session = (pending: "verify" | "enroll" | null, role = "administrador") => ({
  userId: "u1",
  username: "jefe",
  role,
  pending,
  createdAt: new Date(),
});

beforeEach(() => {
  cookieValue.current = "enroll-token";
  secondFactorSession.mockReset();
  twoFactorAvailable.mockReset().mockReturnValue(true);
  redirect.mockClear();
});

describe("TwoFactorSetupPage", () => {
  it.each([
    ["administrador", "Administrador"],
    ["jefe_taller", "Jefe de taller"],
  ])("renders the setup for an enroll session of %s with its role label", async (role, label) => {
    secondFactorSession.mockResolvedValue(session("enroll", role));

    render(await TwoFactorSetupPage());

    expect(secondFactorSession).toHaveBeenCalledWith("enroll-token");
    expect(screen.getByTestId("setup")).toHaveTextContent(`${label}|true`);
  });

  it("tells the setup when the key cannot be read", async () => {
    secondFactorSession.mockResolvedValue(session("enroll"));
    twoFactorAvailable.mockReturnValue(false);

    render(await TwoFactorSetupPage());

    expect(screen.getByTestId("setup")).toHaveTextContent("Administrador|false");
  });

  it("sends a request with no cookie to the login", async () => {
    cookieValue.current = undefined;

    await expect(TwoFactorSetupPage()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(secondFactorSession).not.toHaveBeenCalled();
  });

  it.each([
    ["no usable session", null],
    ["a session pending its code", session("verify")],
  ])("sends %s to the login", async (_label, found) => {
    secondFactorSession.mockResolvedValue(found);

    await expect(TwoFactorSetupPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it.each([
    ["administrador", "/inventory"],
    ["pantalla", "/tablero/clientes"],
  ])("sends a full %s session to its landing %s", async (role, path) => {
    secondFactorSession.mockResolvedValue(session(null, role));

    await expect(TwoFactorSetupPage()).rejects.toThrow(`NEXT_REDIRECT ${path}`);
  });
});
