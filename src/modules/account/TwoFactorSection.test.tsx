import fs from "node:fs";
import path from "node:path";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/ui/ToastProvider", () => ({ useToast: () => ({ addToast }) }));

import { TwoFactorSection } from "./TwoFactorSection";

const CODES = ["7KQM-2XPA", "R9TD-4HWN", "C3MV-8JQE", "M6FB-1ZRT", "P2WN-5KDY", "H8XC-3MVZ", "T4JR-9PQB", "A5ZE-6GHN", "W1YK-7CTF", "D9NV-2RZS"];
const OFF = { enabled: false, enabledOn: null, codesLeft: 0, mandatory: false };
const ON = { enabled: true, enabledOn: "23/11/2026", codesLeft: 8, mandatory: false };

type Reply = { status?: number; body?: unknown };
const fetchMock = vi.fn();
function reply(...replies: Reply[]) {
  for (const r of replies) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 }));
  }
}
const START_OK = { body: { secret: "JBSW Y3DP EHPK 3PXP", otpauthUri: "otpauth://totp/x", qrDataUrl: "data:image/png;base64,QR" } };
const sentTo = (n: number) => [fetchMock.mock.calls[n][0], JSON.parse(fetchMock.mock.calls[n][1]?.body ?? "null")];

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function enrolTo(user: ReturnType<typeof userEvent.setup>, code = "123456") {
  await passwordStep(user);
  reply(START_OK);
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.type(await screen.findByLabelText("Código de la app"), code);
}

async function passwordStep(user: ReturnType<typeof userEvent.setup>, password = "clave-actual") {
  await user.click(screen.getByRole("button", { name: "Activar" }));
  await user.type(await screen.findByLabelText("Contraseña actual"), password);
}

describe("TwoFactorSection — Desactivada", () => {
  it("offers Activar and says 2FA is optional for an optional role", () => {
    render(<TwoFactorSection {...OFF} />);
    expect(screen.getByRole("heading", { name: "Verificación en dos pasos" })).toBeInTheDocument();
    expect(screen.getByText("Desactivada")).toBeInTheDocument();
    expect(screen.getByText("Agregá un código de tu teléfono al iniciar sesión. Es opcional para tu rol.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("does not call it optional for a mandatory role", () => {
    render(<TwoFactorSection {...OFF} mandatory />);
    expect(screen.getByText("Agregá un código de tu teléfono al iniciar sesión. Tu rol la requiere.")).toBeInTheDocument();
    expect(screen.queryByText(/opcional/)).not.toBeInTheDocument();
  });

  it("Activar first asks for the current password, and Cancelar goes back without a request", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);

    await user.click(screen.getByRole("button", { name: "Activar" }));

    const field = screen.getByLabelText("Contraseña actual");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña actual")).not.toBeInTheDocument();
  });

  it("keeps the password step and says so inline on a wrong password, with no QR", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);
    await passwordStep(user, "otra-clave");
    reply({ status: 400, body: { error: "invalid_password" } });

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(sentTo(0)).toEqual(["/api/account/two-factor/start", { password: "otra-clave" }]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta.");
    expect(screen.getByLabelText("Contraseña actual")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Código QR para la app de autenticación" })).not.toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("shows the missing-key message inline when Activar is unavailable", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);
    await passwordStep(user);
    reply({ status: 503, body: { error: "unavailable" } });

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La verificación en dos pasos no está disponible. Avisá al administrador.",
    );
    expect(screen.queryByLabelText("Código de la app")).not.toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
  });
});

describe("TwoFactorSection — enrolling", () => {
  it("shows the QR, the grouped key and one numeric code field; Cancelar goes back", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);
    await passwordStep(user);
    reply(START_OK);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(sentTo(0)).toEqual(["/api/account/two-factor/start", { password: "clave-actual" }]);
    expect(await screen.findByRole("img", { name: "Código QR para la app de autenticación" })).toHaveAttribute(
      "src",
      "data:image/png;base64,QR",
    );
    expect(screen.getByText("¿No podés escanear? Escribí esta clave en la app:")).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    const field = screen.getByLabelText("Código de la app");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de la app")).not.toBeInTheDocument();
  });

  it("keeps the form and says so inline on a wrong code, with no toast", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);
    await enrolTo(user, "000000");
    reply({ status: 400, body: { error: "invalid_code" } });

    await user.click(screen.getByRole("button", { name: "Verificar y activar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Código incorrecto. Revisá la app e intentá de nuevo.");
    expect(screen.getByLabelText("Código de la app")).toBeInTheDocument();
    expect(addToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("on a right code shows the 10 codes once, toasts above the refresh, and keeps them through the refreshed props", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TwoFactorSection {...OFF} />);
    await enrolTo(user, "123456");
    const order: string[] = [];
    addToast.mockImplementation(() => order.push("toast"));
    refresh.mockImplementation(() => order.push("refresh"));
    reply({ body: { codes: CODES } });

    await user.click(screen.getByRole("button", { name: "Verificar y activar" }));

    expect(sentTo(1)).toEqual(["/api/account/two-factor/confirm", { code: "123456" }]);
    const list = await screen.findByRole("list", { name: "Códigos de recuperación" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(CODES);
    expect(screen.getByText(/Cada uno sirve una sola vez, si perdés el teléfono\. Es la única vez que los verás\./)).toHaveTextContent(
      "Guardá tus códigos de recuperación. Cada uno sirve una sola vez, si perdés el teléfono. Es la única vez que los verás.",
    );
    expect(addToast).toHaveBeenCalledWith("success", "Verificación en dos pasos activada");
    expect(order).toEqual(["toast", "refresh"]);

    // router.refresh() re-renders the page with 2FA on: the codes must not vanish before they are saved.
    rerender(<TwoFactorSection {...ON} codesLeft={10} />);
    expect(screen.getByRole("list", { name: "Códigos de recuperación" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ya los guardé" }));
    expect(screen.queryByRole("list", { name: "Códigos de recuperación" })).not.toBeInTheDocument();
    expect(screen.getByText(/Te quedan/)).toHaveTextContent("Activada el 23/11/2026. Te quedan 10 de 10 códigos de recuperación.");
  });

  it("Descargar .txt saves the 10 codes through a Blob and a[download], and Imprimir prints", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...OFF} />);
    await enrolTo(user);
    reply({ body: { codes: CODES } });
    await user.click(screen.getByRole("button", { name: "Verificar y activar" }));
    await screen.findByRole("list", { name: "Códigos de recuperación" });

    let saved: Blob | null = null;
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => ((saved = b), "blob:codes")), revokeObjectURL: revoke }));
    const clicked: HTMLAnchorElement[] = [];
    // Revoking in the same task as the click can cancel the download, so the revoke must come later.
    let revokedInClickTask: number | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
      queueMicrotask(() => (revokedInClickTask = revoke.mock.calls.length));
    });
    const print = vi.fn();
    vi.stubGlobal("print", print);

    await user.click(screen.getByRole("button", { name: "Descargar .txt" }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute("href")).toBe("blob:codes");
    expect(clicked[0].getAttribute("download")).toMatch(/\.txt$/);
    const text = await saved!.text();
    for (const code of CODES) expect(text).toContain(code);
    expect(revokedInClickTask).toBe(0);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:codes"));

    await user.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(print).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  // Plain HTTP over the LAN is an insecure context: no clipboard API (AGENTS.md).
  it("never reaches for the clipboard", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "TwoFactorSection.tsx"), "utf8");
    expect(source).not.toMatch(/navigator\s*\.\s*clipboard|execCommand/);
  });
});

describe("TwoFactorSection — Activa", () => {
  it("shows the date and the codes left, with Generar códigos nuevos and Desactivar", () => {
    render(<TwoFactorSection {...ON} />);
    expect(screen.getByText("Activada")).toBeInTheDocument();
    expect(screen.getByText(/Te quedan/)).toHaveTextContent("Activada el 23/11/2026. Te quedan 8 de 10 códigos de recuperación.");
    expect(screen.getByRole("button", { name: "Generar códigos nuevos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("offers no Desactivar to a mandatory role", () => {
    render(<TwoFactorSection {...ON} mandatory />);
    expect(screen.getByRole("button", { name: "Generar códigos nuevos" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it("explains a lock after too many wrong codes", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...ON} />);
    await user.click(screen.getByRole("button", { name: "Generar códigos nuevos" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código de la app"), "111111");
    reply({ status: 429, body: { error: "locked" } });
    await user.click(within(dialog).getByRole("button", { name: "Generar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Demasiados códigos incorrectos. Por seguridad, el acceso quedó bloqueado por un rato.",
    );
  });

  it("says a code already used is not wrong, only spent", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...ON} />);
    await user.click(screen.getByRole("button", { name: "Generar códigos nuevos" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código de la app"), "111111");
    reply({ status: 409, body: { error: "code_used" } });
    await user.click(within(dialog).getByRole("button", { name: "Generar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ese código ya se usó. Esperá el siguiente en la app.");
  });

  it("Generar códigos nuevos asks for an app code, shows a wrong one inline, then shows the new codes and toasts", async () => {
    const user = userEvent.setup();
    render(<TwoFactorSection {...ON} />);
    await user.click(screen.getByRole("button", { name: "Generar códigos nuevos" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código de la app"), "111111");
    reply({ status: 400, body: { error: "invalid_code" } });
    await user.click(within(dialog).getByRole("button", { name: "Generar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Código incorrecto. Revisá la app e intentá de nuevo.");
    expect(addToast).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText("Código de la app"));
    await user.type(within(dialog).getByLabelText("Código de la app"), "222222");
    reply({ body: { codes: CODES } });
    await user.click(within(dialog).getByRole("button", { name: "Generar" }));

    expect(sentTo(1)).toEqual(["/api/account/two-factor/recovery-codes", { code: "222222" }]);
    const list = await screen.findByRole("list", { name: "Códigos de recuperación" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(addToast).toHaveBeenCalledWith("success", "Códigos de recuperación generados");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Desactivar asks for an app code, then toasts and refreshes", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    addToast.mockImplementation(() => order.push("toast"));
    refresh.mockImplementation(() => order.push("refresh"));
    render(<TwoFactorSection {...ON} />);
    await user.click(screen.getByRole("button", { name: "Desactivar" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código de la app"), "333333");
    reply({ body: { success: true } });

    await user.click(within(dialog).getByRole("button", { name: "Sí, desactivar" }));

    expect(sentTo(0)).toEqual(["/api/account/two-factor/disable", { code: "333333" }]);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Verificación en dos pasos desactivada"));
    expect(order).toEqual(["toast", "refresh"]);
  });
});
