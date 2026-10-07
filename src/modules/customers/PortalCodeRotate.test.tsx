/**
 * "Generar nuevo código" (customer-portal WU2): rotating the portal token makes
 * every QR already printed stop working, so the operator confirms first. Rendered
 * inside the real `ToastProvider`: the toast is a portal on `document.body`, so
 * the confirmation is asserted as text the operator reads.
 */
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PortalCodeRotate } from "./PortalCodeRotate";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

type FetchArgs = [string, RequestInit];

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn<(...args: FetchArgs) => unknown>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Wire shape of POST /api/customers/[id]/portal-token/rotate: `{ rotated: true }`, never the token.
const ok = () => ({ ok: true, status: 200, json: async () => ({ rotated: true }) });
const reply = (status: number) => () => ({ ok: false, status, json: async () => ({}) });

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const trigger = () => screen.getByRole("button", { name: "Generar nuevo código" });

describe("PortalCodeRotate", () => {
  it("rotates nothing until the warning about printed QR codes is confirmed", async () => {
    const fetchMock = mockFetch(ok);
    render(<PortalCodeRotate clienteId="c1" />);

    await userEvent.click(trigger());

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("los QR ya impresos dejarán de funcionar");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling closes the dialog and sends nothing", async () => {
    const fetchMock = mockFetch(ok);
    render(<PortalCodeRotate clienteId="c1" />);

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("confirming posts the explicit confirmation flag, toasts, then refreshes", async () => {
    const fetchMock = mockFetch(ok);
    render(<PortalCodeRotate clienteId="c1" />);

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Sí, generar nuevo código" }));

    expect(await screen.findByText("Código del portal renovado")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/customers/c1/portal-token/rotate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ confirm: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open with the error inline and no toast when the server refuses", async () => {
    mockFetch(reply(409));
    render(<PortalCodeRotate clienteId="c1" />);

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Sí, generar nuevo código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo generar el nuevo código.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Código del portal renovado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a network failure the same way", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<PortalCodeRotate clienteId="c1" />);

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Sí, generar nuevo código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo generar el nuevo código.");
  });

  // `router.refresh()` sits BELOW the try/catch, as in `CustomerActivationButton`:
  // a refresh that throws must neither retract the confirmation nor be reported
  // as a failed rotation over a token the server already replaced.
  it("keeps the confirmation, and shows no error, when the refresh throws after an accepted rotation", async () => {
    mockFetch(ok);
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<PortalCodeRotate clienteId="c1" />);
      await userEvent.click(trigger());
      await userEvent.click(await screen.findByRole("button", { name: "Sí, generar nuevo código" }));

      expect(await screen.findByText("Código del portal renovado")).toBeInTheDocument();
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the 44x44 floor on the trigger", () => {
    render(<PortalCodeRotate clienteId="c1" />);

    expect(trigger()).toHaveClass("min-h-11", "min-w-11");
  });
});
