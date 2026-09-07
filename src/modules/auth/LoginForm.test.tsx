import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LoginForm } from "./LoginForm";

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
