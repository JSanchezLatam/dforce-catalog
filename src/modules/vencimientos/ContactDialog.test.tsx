/**
 * The "Contactar" dialog. Real `Dialog` (a portal), real `ToastProvider` and the
 * real `ContactadoButton`; only `fetch` and the router are faked. Props are the
 * explicit allowlist of design.md "Dialog props" — the page test pins that the
 * page sends nothing else.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { ContactDialog, type ContactDialogProps } from "./ContactDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const BASE: ContactDialogProps = {
  vehiculoId: "v1",
  kind: "placa",
  periodKey: "2026-10",
  overdue: false,
  customerName: "Transportes Chiriquí S.A.",
  placa: "BF0921",
  vehicleLabel: "Nissan Frontier",
  waPhone: "50761111111",
  waBlockedReason: null,
  workshop: { name: "DForce Car Audio", phone: "203-7212", hours: null, address: null },
};

async function openDialog(over: Partial<ContactDialogProps> = {}) {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <ToastProvider>
      <ContactDialog {...BASE} {...over} />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: /Contactar/ }));
  return { user, fetchMock, dialog: within(await screen.findByRole("dialog")) };
}

describe("ContactDialog — the row action", () => {
  it("is closed until 'Contactar' is pressed, and opening it neither marks nor toasts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ToastProvider>
        <ContactDialog {...BASE} />
      </ToastProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Contactar/ }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Contactar a Transportes Chiriquí S.A.")).toBeInTheDocument();
    expect(dialog.getByText("Placa — octubre · Nissan Frontier (BF0921)")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says 'vehículo' in the subtitle when the vehicle has no make and model, and 'venció' for overdue insurance", async () => {
    const { dialog } = await openDialog({ kind: "seguro", periodKey: "2026-09-28", overdue: true, vehicleLabel: null });

    expect(dialog.getByText("Seguro — venció 28/09/2026 · vehículo (BF0921)")).toBeInTheDocument();
  });
});

describe("ContactDialog — price and preview", () => {
  it("previews the message without a price, then with it as it is typed, then without again", async () => {
    const { user, dialog } = await openDialog();
    const preview = () => dialog.getByTestId("contact-preview");

    expect(preview()).toHaveTextContent("corresponde en octubre de 2026. Le ofrecemos el servicio de renovación. Si le interesa");
    expect(preview()).not.toHaveTextContent("B/.");

    await user.type(dialog.getByLabelText("Precio (opcional)"), "45");
    expect(preview()).toHaveTextContent("Le ofrecemos el servicio de renovación por B/. 45.00.");

    await user.clear(dialog.getByLabelText("Precio (opcional)"));
    expect(preview()).not.toHaveTextContent("B/.");
  });

  it("treats a non-numeric price as no price", async () => {
    const { user, dialog } = await openDialog();

    await user.type(dialog.getByLabelText("Precio (opcional)"), "abc");

    expect(dialog.getByTestId("contact-preview")).not.toHaveTextContent("B/.");
  });
});

describe("ContactDialog — WhatsApp", () => {
  it("is a plain link to wa.me carrying the encoded message, in a new tab", async () => {
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByLabelText("Precio (opcional)"), "45");

    const link = dialog.getByRole("link", { name: /WhatsApp/ });
    const href = link.getAttribute("href") ?? "";

    expect(href.startsWith("https://wa.me/50761111111?text=")).toBe(true);
    expect(href).toContain("B%2F.%2045.00");
    expect(href).not.toMatch(/\s/);
    expect(new URL(href).searchParams.get("text")).toBe(dialog.getByTestId("contact-preview").textContent);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("sends no request, shows no toast and does not refresh when it is clicked", async () => {
    const { user, fetchMock, dialog } = await openDialog();
    const link = dialog.getByRole("link", { name: /WhatsApp/ });
    // jsdom does not implement navigation; keep the click from leaving the page.
    link.addEventListener("click", (event) => event.preventDefault());

    await user.click(link);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Vencimiento marcado como contactado")).not.toBeInTheDocument();
    expect(dialog.getByText("Abrir WhatsApp no marca el vencimiento como contactado.")).toBeInTheDocument();
  });

  it("is disabled with its reason when the customer opted out, and 'Marcar como contactado' still works", async () => {
    const { user, fetchMock, dialog } = await openDialog({ waPhone: null, waBlockedReason: "El cliente pidió no recibir WhatsApp" });

    expect(dialog.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /WhatsApp/ })).toBeDisabled();
    expect(dialog.getByText("El cliente pidió no recibir WhatsApp")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Marcar como contactado" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Vencimiento marcado como contactado")).toBeInTheDocument();
  });

  it("is disabled with its own reason when the phone is not a mobile", async () => {
    const { dialog } = await openDialog({ waPhone: null, waBlockedReason: "El teléfono del cliente no es un celular" });

    expect(dialog.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /WhatsApp/ })).toBeDisabled();
    expect(dialog.getByText("El teléfono del cliente no es un celular")).toBeInTheDocument();
    expect(dialog.queryByText("El cliente pidió no recibir WhatsApp")).not.toBeInTheDocument();
  });
});

describe("ContactDialog — the other buttons", () => {
  it("shows 'Correo' disabled and labelled 'Próximamente'", async () => {
    const { dialog } = await openDialog();

    const correo = dialog.getByRole("button", { name: /Correo/ });
    expect(correo).toBeDisabled();
    expect(correo).toHaveTextContent("Próximamente");
  });

  it("'Marcar como contactado' POSTs the item identity and toasts the confirmation", async () => {
    const { user, fetchMock, dialog } = await openDialog();

    await user.click(dialog.getByRole("button", { name: "Marcar como contactado" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/vencimientos/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehiculoId: "v1", kind: "placa", periodKey: "2026-10" }),
    });
    expect(await screen.findByText("Vencimiento marcado como contactado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
