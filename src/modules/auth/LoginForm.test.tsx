import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loginAction = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/actions", () => ({ loginAction }));

import { LoginForm } from "./LoginForm";

beforeEach(() => loginAction.mockReset());

async function submitLocked(retryAt: number) {
  loginAction.mockResolvedValue({
    error: "Demasiados intentos fallidos.",
    detail: "Por seguridad, el acceso quedó bloqueado.",
    lockedUsername: "ana",
    retryAt,
  });
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.type(screen.getByLabelText("Usuario"), "ana");
  await user.type(screen.getByLabelText("Contraseña"), "clave");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  await screen.findByRole("alert");
  return user;
}

describe("LoginForm — locked login", () => {
  it("shows the lock and disables the button for that login", async () => {
    await submitLocked(Date.now() + 60_000);

    expect(screen.getByRole("alert")).toHaveTextContent("Demasiados intentos fallidos.");
    expect(screen.getByRole("alert")).toHaveTextContent("Por seguridad, el acceso quedó bloqueado.");
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeDisabled();
  });

  it("enables the button again for a different login", async () => {
    const user = await submitLocked(Date.now() + 60_000);

    await user.type(screen.getByLabelText("Usuario"), "2");

    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  });

  it("enables the button again when the lock ends", async () => {
    await submitLocked(Date.now() + 100);

    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled());
  });
});

describe("LoginForm", () => {
  it("renders the Spanish login contract", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Usuario")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeDisabled();
  });

  /**
   * The validation message needs an interaction to exist, so the first-render
   * assertions above could never reach it — and it is the string this change
   * actually rewrote. Reverting `validateField`'s "Requerido" to "Required"
   * left the whole suite green until this test existed.
   */
  it("names an empty field in Spanish once the user has left it", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const username = screen.getByLabelText("Usuario");
    await user.click(username);
    await user.tab();

    expect(await screen.findByText("Requerido")).toBeInTheDocument();
  });
});
