/**
 * Mirrors `CustomerFormTrigger.test.tsx`. `UserForm` is driven for real — the
 * thing under test is which of the two messages the wrapper picks, and `user`
 * is the only prop that tells create from edit.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { UserFormTrigger } from "./UserFormTrigger";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const EXISTING = {
  id: "u-1",
  username: "ana",
  name: "Ana Ruiz",
  email: "ana@taller.com",
  role: "administrador",
};

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: "u-1" } }) }),
  );
}

/** The real provider, not a fake: it portals into `document.body`, which is what `screen` queries. */
function renderTrigger(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("UserFormTrigger — a save the operator can see", () => {
  it("says the user was created after a create", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderTrigger(<UserFormTrigger />);

    await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Usuario"), "beto");
    await user.click(screen.getByLabelText("Rol"));
    await user.click(await screen.findByRole("option", { name: "Técnico" }));
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Usuario creado")).toBeInTheDocument();
    expect(screen.queryByText("Usuario actualizado")).not.toBeInTheDocument();
  });

  it("says the user was updated after an edit", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderTrigger(<UserFormTrigger user={EXISTING} />);

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Usuario actualizado")).toBeInTheDocument();
    expect(screen.queryByText("Usuario creado")).not.toBeInTheDocument();
  });
});
