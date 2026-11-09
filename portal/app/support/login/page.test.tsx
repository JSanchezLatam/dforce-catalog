// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

let authed: boolean;
vi.mock("../../../src/support/session", () => ({ requireSupport: async () => authed }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
beforeEach(() => {
  authed = false;
});
afterEach(cleanup);

describe("/support/login", () => {
  it("sends an already signed-in user straight to the inbox", async () => {
    authed = true;
    await expect(Page()).rejects.toThrow("REDIRECT /support");
  });

  it("shows the support copy, a Contraseña field and Entrar, and none of the customer brand", async () => {
    const { container } = render(await Page());
    expect(screen.getByRole("heading", { name: "Soporte — Dforce" })).toBeTruthy();
    expect(screen.getByText("Acceso solo para el equipo de desarrollo.")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
    expect(container.textContent).not.toContain("DForce Car Audio");
  });
});
