/**
 * The row action of /vencimientos. Real `ToastProvider` (it portals into
 * `document.body`, which is what `screen` queries); only `fetch` and the router
 * are faked. The refresh-throws case is what pins the AGENTS.md ordering: toast
 * above `router.refresh()`, both below the `try/catch`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { ContactadoButton } from "./ContactadoButton";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

function renderButton() {
  return render(
    <ToastProvider>
      <ContactadoButton vehiculoId="v1" kind="placa" periodKey="2026-10" />
    </ToastProvider>,
  );
}

const BUTTON = { name: "Marcar como contactado" };

describe("ContactadoButton", () => {
  it("POSTs the item's identity, toasts the singular confirmation and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    renderButton();
    await user.click(screen.getByRole("button", BUTTON));

    expect(fetchMock).toHaveBeenCalledWith("/api/vencimientos/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehiculoId: "v1", kind: "placa", periodKey: "2026-10" }),
    });
    expect(await screen.findByText("Vencimiento marcado como contactado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation, and does not blame the network, when the refresh throws after an accepted mark", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw escapes `mark` (that is the property under test), so it surfaces
    // as an unhandled rejection; capture it instead of leaving it to the runner.
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderButton();
      await user.click(screen.getByRole("button", BUTTON));
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(await screen.findByText("Vencimiento marcado como contactado")).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo conectar/)).not.toBeInTheDocument();
  });

  it("says so and neither toasts success nor refreshes when the server refuses, and the button comes back", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderButton();
    await user.click(screen.getByRole("button", BUTTON));

    expect(await screen.findByText("No se pudo marcar el vencimiento como contactado.")).toBeInTheDocument();
    expect(screen.queryByText("Vencimiento marcado como contactado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", BUTTON)).toBeEnabled();
  });

  it("tells the operator when the request never lands, and the button comes back", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    renderButton();
    await user.click(screen.getByRole("button", BUTTON));

    expect(await screen.findByText("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", BUTTON)).toBeEnabled();
  });
});
