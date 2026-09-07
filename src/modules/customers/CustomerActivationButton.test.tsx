/**
 * R20 — the component that actually performs the deactivation. `page.test.tsx`
 * only asserts which LABEL renders; the fetch, the payload, the refresh and
 * both failure paths had no coverage at all until this file.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CustomerActivationButton } from "./CustomerActivationButton";

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

  it("shows an error and does NOT refresh when the server refuses", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false, status: 409, json: async () => ({ error: "cliente_deactivated" }) }));
    render(<CustomerActivationButton clienteId="c1" isActive />);

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo desactivar el cliente.");
    expect(refresh).not.toHaveBeenCalled();
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
