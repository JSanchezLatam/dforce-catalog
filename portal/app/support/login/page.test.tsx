// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
afterEach(cleanup);

describe("/support/login", () => {
  it("shows the support copy, a Contraseña field and Entrar, and none of the customer brand", () => {
    const { container } = render(<Page />);
    expect(screen.getByRole("heading", { name: "Soporte — Dforce" })).toBeTruthy();
    expect(screen.getByText("Acceso solo para el equipo de desarrollo.")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
    expect(container.textContent).not.toContain("DForce Car Audio");
  });
});
