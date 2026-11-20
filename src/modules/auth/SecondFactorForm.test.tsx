import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecondFactorForm } from "./SecondFactorForm";

const assign = vi.fn();
const fetchMock = vi.fn();

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers }));
}

beforeEach(() => {
  assign.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("location", { assign });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submitCode(code = "123456") {
  const user = userEvent.setup();
  render(<SecondFactorForm />);
  await user.type(screen.getByLabelText("Código de verificación"), code);
  await user.click(screen.getByRole("button", { name: "Verificar" }));
  return user;
}

describe("SecondFactorForm", () => {
  it("asks for the app code in one numeric one-time-code field (S12)", () => {
    render(<SecondFactorForm />);

    const field = screen.getByLabelText("Código de verificación");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("maxlength", "6");
    expect(field).toHaveAccessibleDescription("Abrí tu app de autenticación y escribí el código de 6 dígitos.");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("posts the code and goes where the server says on success", async () => {
    reply(200, { ok: true, redirect: "/inventory" });

    await submitCode("123456");

    expect(fetchMock).toHaveBeenCalledWith("/api/two-factor/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/inventory"));
  });

  it("switches to a recovery code field and back to the app code", async () => {
    const user = userEvent.setup();
    render(<SecondFactorForm />);

    await user.click(screen.getByRole("button", { name: "¿Perdiste el teléfono? Usar un código de recuperación" }));
    const recovery = screen.getByLabelText("Código de recuperación");
    expect(recovery).not.toHaveAttribute("inputmode", "numeric");
    expect(recovery).not.toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.queryByLabelText("Código de verificación")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Usar el código de la app" }));
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("posts a recovery code as recoveryCode and names it when it is wrong", async () => {
    const user = userEvent.setup();
    render(<SecondFactorForm />);
    reply(401, { error: "invalid_code" });

    await user.click(screen.getByRole("button", { name: "¿Perdiste el teléfono? Usar un código de recuperación" }));
    await user.type(screen.getByLabelText("Código de recuperación"), "7KQM-2XPA");
    await user.click(screen.getByRole("button", { name: "Verificar" }));

    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ recoveryCode: "7KQM-2XPA" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Código de recuperación incorrecto.");
  });

  it("explains a wrong app code inline", async () => {
    reply(401, { error: "invalid_code" });

    await submitCode();

    expect(await screen.findByRole("alert")).toHaveTextContent("Código incorrecto. Revisá la app e intentá de nuevo.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("explains a timed lock with the minutes left", async () => {
    reply(429, { error: "locked" }, { "Retry-After": String(14 * 60 + 1) });

    await submitCode();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Demasiados intentos fallidos.");
    expect(alert).toHaveTextContent(
      "Por seguridad, el acceso quedó bloqueado. Intentá de nuevo en 15 minutos o pedí al administrador que te desbloquee.",
    );
  });

  it("sends a lock until an unlock to the administrator", async () => {
    reply(429, { error: "locked" });

    await submitCode();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Demasiados intentos fallidos.Por seguridad, el acceso quedó bloqueado. Pedí al administrador que te desbloquee.",
    );
  });

  it("sends a session that expired back to the login", async () => {
    reply(401, { error: "no_pending_session" });

    await submitCode();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("La verificación venció. Volvé a iniciar sesión.");
    expect(screen.getByRole("link", { name: "Volvé a iniciar sesión." })).toHaveAttribute("href", "/login");
  });

  // The proxy answers an expired session before the route runs, with its own body.
  it("sends a session the proxy no longer accepts back to the login", async () => {
    reply(401, { error: "Unauthorized" });

    await submitCode();

    expect(await screen.findByRole("alert")).toHaveTextContent("La verificación venció. Volvé a iniciar sesión.");
  });

  it("does not blame 2FA when the proxy cannot reach the database", async () => {
    reply(503, { error: "Service unavailable" });

    await submitCode();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo verificar el código. Intentá de nuevo.");
  });

  it("says when 2FA is unavailable on this install", async () => {
    reply(503, { error: "unavailable" });

    await submitCode();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La verificación en dos pasos no está disponible. Avisá al administrador.",
    );
  });

  it("logs out and returns to the login", async () => {
    const user = userEvent.setup();
    render(<SecondFactorForm />);
    reply(200, { ok: true });

    await user.click(screen.getByRole("button", { name: "Volver al inicio de sesión" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/logout", { method: "POST" });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("gives every control a 44px touch height", () => {
    render(<SecondFactorForm />);

    expect(screen.getByLabelText("Código de verificación")).toHaveClass("h-11");
    for (const button of screen.getAllByRole("button")) expect(button.className).toMatch(/\b(h-11|min-h-11)\b/);
  });
});
