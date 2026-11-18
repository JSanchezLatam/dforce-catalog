import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PasswordForm } from "./PasswordForm";

function mockFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit(user: ReturnType<typeof userEvent.setup>, next: string) {
  await user.type(screen.getByLabelText("Contraseña actual"), "clave-actual-1");
  await user.type(screen.getByLabelText("Nueva contraseña"), next);
  await user.type(screen.getByLabelText("Confirmar nueva contraseña"), next);
  await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("PasswordForm — password policy", () => {
  it("explains the policy beside the new password", () => {
    render(<PasswordForm />);

    expect(screen.getByLabelText("Nueva contraseña")).toHaveAccessibleDescription(
      "Mínimo 10 caracteres. No puede ser una contraseña común.",
    );
  });

  it("blocks a short password before calling the server", async () => {
    const fetchMock = mockFetch(200);
    const user = userEvent.setup();
    render(<PasswordForm />);

    await submit(user, "corta-123");

    expect(await screen.findByRole("alert")).toHaveTextContent("La contraseña debe tener al menos 10 caracteres.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a policy rejection on the new password, not on the current one", async () => {
    mockFetch(400, { error: "Es demasiado común. Elegí otra.", field: "newPassword" });
    const user = userEvent.setup();
    render(<PasswordForm />);

    await submit(user, "password123");

    expect(await screen.findByRole("alert")).toHaveTextContent("Es demasiado común. Elegí otra.");
    expect(screen.getByLabelText("Nueva contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Contraseña actual")).not.toHaveAttribute("aria-invalid", "true");
  });
});
