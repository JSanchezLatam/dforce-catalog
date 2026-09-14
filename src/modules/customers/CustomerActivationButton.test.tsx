/**
 * R20 — the component that actually performs the deactivation. `page.test.tsx`
 * only asserts which LABEL renders; the fetch, the payload, the refresh and
 * both failure paths had no coverage at all until this file.
 */
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CustomerActivationButton } from "./CustomerActivationButton";

/**
 * Every case below renders inside the REAL provider, not a fake: the toast is
 * a portal on `document.body`, which is exactly what `screen` queries, so the
 * success message can be asserted as rendered text rather than as a spy call.
 * A spy proves the function ran; it does not prove anything reached the
 * operator's screen.
 */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

type FetchArgs = [string, RequestInit];

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn<(...args: FetchArgs) => unknown>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = () => ({ ok: true, status: 200, json: async () => ({}) });

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("CustomerActivationButton (R20)", () => {
  it("sends active:false when deactivating an active customer", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok);
    render(<CustomerActivationButton clienteId="c1" isActive />);

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/customers/c1");
    expect(init.method).toBe("PATCH");
    // `active`, not `deactivatedAt`. The route routes this key to the
    // activation service; a column name here would reach `updateCliente` and
    // become a SET on a column that does not exist.
    expect(JSON.parse(init.body as string)).toEqual({ active: false });
  });

  it("sends active:true when reactivating a deactivated customer", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok);
    render(<CustomerActivationButton clienteId="c1" isActive={false} />);

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ active: true });
  });

  it("refreshes the server-rendered page on success", async () => {
    const user = userEvent.setup();
    mockFetch(ok);
    render(<CustomerActivationButton clienteId="c1" isActive />);

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(refresh).toHaveBeenCalledOnce();
  });

  /**
   * The button REPLACES itself with its inverse on success, so "Desactivar"
   * becoming "Reactivar" is the only thing that used to acknowledge the click
   * — and only after `router.refresh()` has re-rendered the server component,
   * which never happens in the browser until the round trip lands.
   */
  it("says the customer was deactivated", async () => {
    const user = userEvent.setup();
    mockFetch(ok);
    render(<CustomerActivationButton clienteId="c1" isActive />);

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByText("Cliente desactivado")).toBeInTheDocument();
  });

  it("says the customer was reactivated", async () => {
    const user = userEvent.setup();
    mockFetch(ok);
    render(<CustomerActivationButton clienteId="c1" isActive={false} />);

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    expect(await screen.findByText("Cliente reactivado")).toBeInTheDocument();
  });

  /**
   * `router.refresh()` sits BELOW the try/catch, matching
   * `OrderStatusControls`: a refresh that throws must not be reported as a
   * failed deactivation over a mutation the server already accepted, and must
   * not retract the confirmation the operator has already read. It used to sit
   * inside the `try`, where the `catch` turned it into "No se pudo desactivar
   * el cliente." — with every test in this file green.
   */
  it("does not blame the customer's deactivation when the refresh itself throws", async () => {
    const user = userEvent.setup();
    mockFetch(ok);
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw ESCAPES `toggle`, which is the property under test, so it
    // surfaces as an unhandled rejection. Captured rather than left to the
    // runner: a stray one is silent under this config and red under a
    // stricter one, and capturing it turns "no error appeared" into a
    // positive assertion about where the error went.
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<CustomerActivationButton clienteId="c1" isActive />);
      await user.click(screen.getByRole("button", { name: "Desactivar" }));

      expect(await screen.findByText("Cliente desactivado")).toBeInTheDocument();
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error and does NOT refresh when the server refuses", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false, status: 409, json: async () => ({ error: "cliente_deactivated" }) }));
    render(<CustomerActivationButton clienteId="c1" isActive />);

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo desactivar el cliente.");
    expect(refresh).not.toHaveBeenCalled();
    // …and never the confirmation beside the refusal.
    expect(screen.queryByText("Cliente desactivado")).not.toBeInTheDocument();
  });

  // The path that had no branch at all: `fetch` REJECTS on a network failure
  // rather than returning a non-ok response. Without a catch the button
  // re-enabled with nothing on screen and staff clicked into the same silence.
  it("shows an error when fetch itself rejects", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    render(<CustomerActivationButton clienteId="c1" isActive={false} />);

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo reactivar el cliente.");
  });

  it("re-enables the button after a failure so the action can be retried", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new Error("network down");
    });
    render(<CustomerActivationButton clienteId="c1" isActive />);

    const button = screen.getByRole("button", { name: "Desactivar" });
    await user.click(button);

    await screen.findByRole("alert");
    expect(button).toBeEnabled();
  });
});
