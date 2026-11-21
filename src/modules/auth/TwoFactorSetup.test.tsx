import fs from "node:fs";
import path from "node:path";
import { StrictMode } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addToast = vi.hoisted(() => vi.fn());
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { TwoFactorSetup } from "./TwoFactorSetup";

const CODES = ["7KQM-2XPA", "R9TD-4HWN", "C3MV-8JQE", "M6FB-1ZRT", "P2WN-5KDY", "H8XC-3MVZ", "T4JR-9PQB", "A5ZE-6GHN", "W1YK-7CTF", "D9NV-2RZS"];
const START_OK = { secret: "JBSW Y3DP EHPK 3PXP", otpauthUri: "otpauth://totp/x", qrDataUrl: "data:image/png;base64,QR" };

const assign = vi.fn();
const fetchMock = vi.fn();
function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
const sentTo = (n: number) => [fetchMock.mock.calls[n][0], fetchMock.mock.calls[n][1]?.method, fetchMock.mock.calls[n][1]?.body];

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("location", { assign });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function ready() {
  reply(200, START_OK);
  render(<TwoFactorSetup roleLabel="Jefe de taller" available />);
  await screen.findByRole("img", { name: "Código QR para la app de autenticación" });
}

describe("TwoFactorSetup — mockup s3 (S12)", () => {
  it("shows the s3 copy, the role, the three steps, the QR and the grouped key", async () => {
    await ready();

    expect(screen.getByRole("heading", { level: 1, name: "Configurá la verificación en dos pasos" })).toBeInTheDocument();
    expect(screen.getByText("Jefe de taller").closest("p")).toHaveTextContent("Tu rol de Jefe de taller la requiere. Te toma un minuto.");
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Instalá una app de autenticación (Google Authenticator, Microsoft Authenticator o similar).",
      "Escaneá este código con la app.",
      "Escribí el código de 6 dígitos que te muestra.",
    ]);
    expect(screen.getByRole("img", { name: "Código QR para la app de autenticación" })).toHaveAttribute("src", START_OK.qrDataUrl);
    expect(screen.getByText("¿No podés escanear? Escribí esta clave en la app:")).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar y continuar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("starts the setup once on mount, with a POST", async () => {
    await ready();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentTo(0)).toEqual(["/api/two-factor/setup/start", "POST", undefined]);
  });

  // Each start replaces the secret: a second one would leave the QR on screen out of date.
  it("starts only once under Strict Mode's double effect", async () => {
    reply(200, START_OK);
    reply(200, { ...START_OK, secret: "SECOND", qrDataUrl: "data:image/png;base64,SECOND" });
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />, { wrapper: StrictMode });

    await screen.findByRole("img", { name: "Código QR para la app de autenticación" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for the code in one numeric one-time-code field", async () => {
    await ready();

    const field = screen.getByLabelText("Código de la app");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("maxlength", "6");
  });

  it("on a right code shows the 10 codes once with a toast, then Ya los guardé goes to the landing", async () => {
    const user = userEvent.setup();
    await ready();
    reply(200, { codes: CODES, redirect: "/inventory" });

    await user.type(screen.getByLabelText("Código de la app"), "123456");
    await user.click(screen.getByRole("button", { name: "Activar y continuar" }));

    expect(sentTo(1)).toEqual(["/api/two-factor/setup/confirm", "POST", JSON.stringify({ code: "123456" })]);
    const list = await screen.findByRole("list", { name: "Códigos de recuperación" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(CODES);
    expect(screen.queryByLabelText("Código de la app")).not.toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "Verificación en dos pasos activada");
    expect(assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ya los guardé" }));
    expect(assign).toHaveBeenCalledWith("/inventory");
  });

  it.each([
    [400, "invalid_code", "Código incorrecto. Revisá la app e intentá de nuevo."],
    [401, "no_pending_session", "La configuración venció. Volvé a iniciar sesión."],
    [500, "boom", "No se pudo completar. Intentá de nuevo."],
  ])("keeps the form and says so inline on a %i %s, with no toast", async (status, error, text) => {
    const user = userEvent.setup();
    await ready();
    reply(status, { error });

    await user.type(screen.getByLabelText("Código de la app"), "000000");
    await user.click(screen.getByRole("button", { name: "Activar y continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Código de la app")).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("Cerrar sesión logs out, then goes to the login", async () => {
    const user = userEvent.setup();
    await ready();
    reply(200, {});

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(sentTo(1)).toEqual(["/api/logout", "POST", undefined]);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });
});

describe("TwoFactorSetup — a failed start (L44)", () => {
  const GENERIC = "No se pudo completar. Intentá de nuevo.";
  const QR = { name: "Código QR para la app de autenticación" };

  it("offers Reintentar beside Cerrar sesión, and one click starts again and shows the QR", async () => {
    const user = userEvent.setup();
    reply(500, { error: "boom" });
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />);

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reintentar", "Cerrar sesión"]);

    reply(200, START_OK);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("img", QR)).toHaveAttribute("src", START_OK.qrDataUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTo(1)).toEqual(["/api/two-factor/setup/start", "POST", undefined]);
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("keeps offering Reintentar while the start keeps failing, one start per click", async () => {
    const user = userEvent.setup();
    reply(500, { error: "boom" });
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />);
    await screen.findByRole("button", { name: "Reintentar" });

    reply(500, { error: "boom" });
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not offer Reintentar once the setup expired", async () => {
    reply(401, { error: "no_pending_session" });
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />);

    expect(await screen.findByRole("alert")).toHaveTextContent("La configuración venció. Volvé a iniciar sesión.");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar sesión"]);
  });

  it("starts only once under Strict Mode even after a failure", async () => {
    reply(500, { error: "boom" });
    reply(200, START_OK);
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />, { wrapper: StrictMode });

    await screen.findByRole("button", { name: "Reintentar" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The 44x44 rule (AGENTS.md): jsdom measures nothing, so the class is the evidence.
  it("gives Reintentar a 44px hit target", async () => {
    reply(500, { error: "boom" });
    render(<TwoFactorSetup roleLabel="Jefe de taller" available />);

    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(retry.className).toMatch(/\bmin-h-11\b/);
    expect(retry.className).toMatch(/\bmin-w-11\b/);
  });
});

describe("TwoFactorSetup — no usable key", () => {
  const MESSAGE = "La verificación en dos pasos no está disponible. Avisá al administrador.";

  it("shows only the message and Cerrar sesión, and starts nothing", () => {
    render(<TwoFactorSetup roleLabel="Administrador" available={false} />);

    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar sesión"]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código de la app")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches to the same message when the start answers 503", async () => {
    reply(503, { error: "unavailable" });
    render(<TwoFactorSetup roleLabel="Administrador" available />);

    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cerrar sesión"]);
  });
});

// Plain HTTP over the LAN is an insecure context: no clipboard API (AGENTS.md).
it("never reaches for the clipboard", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "TwoFactorSetup.tsx"), "utf8");
  expect(source).not.toMatch(/navigator\s*\.\s*clipboard|execCommand/);
});
