/**
 * R21/D6 — this component had NO test file at all before this one. Covers
 * the request shape, both report paths (success/non-ok), and the network
 * failure `fetch` itself can raise, which the component previously had no
 * `catch` for (same defect already fixed once in `CustomerActivationButton`).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";
import { CustomerImportButton } from "./CustomerImportButton";

type FetchArgs = [string, RequestInit];

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn<(...args: FetchArgs) => unknown>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: object) => ({ ok: true, status: 200, json: async () => body });

function renderButton() {
  return render(
    <ToastProvider>
      <CustomerImportButton />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CustomerImportButton (R21)", () => {
  it("posts to /api/customer-import", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ok({ created: 0, updated: 0, skipped: [] }));
    renderButton();

    await user.click(screen.getByRole("button", { name: "Importar clientes" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/customer-import");
    expect(init.method).toBe("POST");
  });

  it("reports created / updated / skipped to the operator on a successful run", async () => {
    const user = userEvent.setup();
    mockFetch(() => ok({ created: 2, updated: 1, skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }] }));
    renderButton();

    await user.click(screen.getByRole("button", { name: "Importar clientes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("2 nuevos, 1 actualizados, 1 omitidos");
  });

  it("shows an error and does not report success when the response is not ok", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false, status: 502, json: async () => ({ error: "No se pudo importar los clientes." }) }));
    renderButton();

    await user.click(screen.getByRole("button", { name: "Importar clientes" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No se pudo importar los clientes.");
    expect(status).not.toHaveTextContent("nuevos");
  });

  // The path that had no branch at all: `fetch` REJECTS on a network failure
  // rather than returning a non-ok response. Without a catch the button
  // re-enabled with nothing on screen and the operator clicked again into
  // the same silence.
  it("shows an error when fetch itself rejects", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    renderButton();

    await user.click(screen.getByRole("button", { name: "Importar clientes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("No se pudo importar");
  });

  it("re-enables the button after a failure so the action can be retried", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    renderButton();

    const button = screen.getByRole("button", { name: "Importar clientes" });
    await user.click(button);

    await screen.findByRole("status");
    expect(button).toBeEnabled();
  });

  // Finding 5 / D5 — the skip report exists so "the owner can add the real
  // number". A count alone ("9 omitidos") names nobody; the operator needs
  // the actual name on screen to act on it.
  it("lists a skipped customer by name so the owner can act on it", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      ok({ created: 0, updated: 0, skipped: [{ externalId: "9", name: "Sin Telefono", reason: "missing_phone" }] }),
    );
    renderButton();

    await user.click(screen.getByRole("button", { name: "Importar clientes" }));

    expect(await screen.findByText("Sin Telefono")).toBeInTheDocument();
  });
});
