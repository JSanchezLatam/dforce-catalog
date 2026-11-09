// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const submit = (password: string) => {
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
};

describe("LoginForm", () => {
  it("posts the password and goes to the inbox on success", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<LoginForm />);
    submit("hunter2");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/support"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/support/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ password: "hunter2" });
    expect(screen.getByLabelText("Contraseña").getAttribute("aria-invalid")).toBeNull();
  });

  it("a 401 marks the field invalid and shows 'Contraseña incorrecta.'", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    render(<LoginForm />);
    submit("nope");
    const err = await screen.findByText("Contraseña incorrecta.");
    const input = screen.getByLabelText("Contraseña");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(err.id);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a 429 shows the throttle message and does not blame the password", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    render(<LoginForm />);
    submit("whatever");
    await screen.findByText("Demasiados intentos. Probá de nuevo en unos minutos.");
    expect(screen.getByLabelText("Contraseña").getAttribute("aria-invalid")).toBeNull();
  });

  it("a network failure or an unconfigured portal shows a generic retry message", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("{}", { status: 503 }));
    render(<LoginForm />);
    submit("x");
    await screen.findByText("No se pudo iniciar sesión. Probá de nuevo.");
    submit("x");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText("No se pudo iniciar sesión. Probá de nuevo.");
  });

  it("the button is disabled while the request is in flight", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<LoginForm />);
    submit("x");
    await waitFor(() => expect((screen.getByRole("button", { name: /Entrar|Entrando/ }) as HTMLButtonElement).disabled).toBe(true));
  });
});
