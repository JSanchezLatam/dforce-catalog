/**
 * Component tests for `CustomerPicker` (jsdom + mocked `fetch`, see
 * AGENTS.md's Component testing section — `.test.tsx` routes to the
 * `jsdom` project). No real backend behaviour is provable here (design.md's
 * Testing Strategy) — that half lives in `route.test.ts` and the
 * `customer search (E2E)` describe.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteListItem } from "@/modules/customers/queries";
import { CustomerPicker } from "./CustomerPicker";

function row(overrides: Partial<ClienteListItem> = {}): ClienteListItem {
  return {
    id: "c-default",
    name: "Cliente Default",
    phone: "50761111111",
    email: null,
    vehiclePlate: "ABC111",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function failedResponse(status: number) {
  return { ok: false, status, json: async () => ({ error: "Forbidden" }) } as Response;
}

function searchInput() {
  return screen.getByRole("textbox", { name: /buscar cliente/i });
}

/** Types into the search box and flushes the 300ms debounce + the fetch microtask. */
async function typeAndDebounce(value: string) {
  fireEvent.change(searchInput(), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CustomerPicker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ customers: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fires one fetch per debounced typing burst, not one per keystroke", async () => {
    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);

    fireEvent.change(searchInput(), { target: { value: "j" } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(searchInput(), { target: { value: "ju" } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(searchInput(), { target: { value: "juan" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("search=juan");
  });

  it("keeps a selectedCustomer prop rendered as selected even when a later search excludes it", async () => {
    const selected = row({ id: "c-selected", name: "Ya Elegido" });
    fetchMock.mockResolvedValue(jsonResponse({ customers: [row({ id: "c-other", name: "Otro Cliente" })], total: 1 }));

    render(<CustomerPicker selectedCustomer={selected} canCreateCustomer={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Ya Elegido")).toBeInTheDocument();

    await typeAndDebounce("otro");

    expect(screen.getByText("Otro Cliente")).toBeInTheDocument();
    expect(screen.getByText("Ya Elegido")).toBeInTheDocument();
  });

  it("falls back through phone, then email, then the registration date when a row has no plate", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        customers: [
          row({ id: "c-plate", name: "Con Placa", vehiclePlate: "XYZ999", phone: "50769999999" }),
          row({ id: "c-phone-only", name: "Solo Teléfono", vehiclePlate: null, phone: "50768888888" }),
          row({ id: "c-email-only", name: "Solo Email", vehiclePlate: null, phone: null, email: "sin.telefono@example.com" }),
          row({ id: "c-bare", name: "Sin Nada", vehiclePlate: null, phone: null, email: null }),
        ],
        total: 4,
      }),
    );

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("cliente");

    expect(screen.getByText("XYZ999")).toBeInTheDocument();
    expect(screen.getByText("50768888888")).toBeInTheDocument();
    expect(screen.getByText("sin.telefono@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Registrado el/)).toBeInTheDocument();
  });

  it("renders near matches before the create action when the search relaxed, never beside it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ customers: [row({ id: "c-near", name: "Juan Cerca" })], total: 1, relaxedFrom: "Juan" }),
    );

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("Juan Alberto");

    const near = screen.getByText("Juan Cerca");
    const create = screen.getByRole("button", { name: /crear cliente nuevo/i });
    expect(near.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the create action when canCreateCustomer is false, even with near matches present", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ customers: [row({ id: "c-near", name: "Juan Cerca" })], total: 1, relaxedFrom: "Juan" }),
    );

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("Juan Alberto");

    expect(screen.getByText("Juan Cerca")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /crear cliente nuevo/i })).not.toBeInTheDocument();
  });

  /**
   * A failed search used to leave `hasSearched` false, so the dialog rendered
   * nothing at all: no rows, no empty state, no create action. A 403, a 500
   * and a dropped connection were indistinguishable from "keep typing".
   */
  it("surfaces an error when the search request is rejected outright", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("juan");

    expect(screen.getByRole("alert")).toHaveTextContent(/No se pudo buscar clientes/i);
  });

  it("surfaces an error when the search responds with a failure status", async () => {
    fetchMock.mockResolvedValue(failedResponse(403));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("juan");

    expect(screen.getByRole("alert")).toHaveTextContent(/No se pudo buscar clientes/i);
  });

  it("clears a previous error once a later search succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(failedResponse(500))
      .mockResolvedValueOnce(jsonResponse({ customers: [row({ id: "c-ok", name: "Cliente Ok" })], total: 1 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("juan");
    await typeAndDebounce("juana");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Cliente Ok")).toBeInTheDocument();
  });

  it("ignores a slow earlier response that lands after a newer search resolved", async () => {
    let landFirst: () => void = () => {};
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            landFirst = () => resolve(jsonResponse({ customers: [row({ id: "c-old", name: "Viejo" })], total: 1 }));
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ customers: [row({ id: "c-new", name: "Nuevo" })], total: 1 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("vie");
    await typeAndDebounce("nue");

    await act(async () => {
      landFirst();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Nuevo")).toBeInTheDocument();
    expect(screen.queryByText("Viejo")).not.toBeInTheDocument();
  });

  it("shows only the create action when there are zero exact and zero near matches", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ customers: [], total: 0 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("nadie-existe");

    expect(screen.getByRole("button", { name: /crear cliente nuevo/i })).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });
});
