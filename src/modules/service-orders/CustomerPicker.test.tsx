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
    // The picker never SEES a deactivated customer - `listClientes` excludes
    // them before the route answers (R20/D3), which is exactly why the picker
    // needed no change of its own.
    deactivatedAt: null,
    plates: ["ABC111"],
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
          row({ id: "c-plate", name: "Con Placa", plates: ["XYZ999"], phone: "50769999999" }),
          row({ id: "c-phone-only", name: "Solo Teléfono", plates: [], phone: "50768888888" }),
          row({ id: "c-email-only", name: "Solo Email", plates: [], phone: "", email: "sin.telefono@example.com" }),
          row({ id: "c-bare", name: "Sin Nada", plates: [], phone: "", email: null }),
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
   * The route defaults to DEFAULT_PAGE_SIZE = 10 ordered by `desc(createdAt)`.
   * A common surname across hundreds of customers therefore showed the ten most
   * recently created and hid the rest — with nothing saying so, which is exactly
   * how staff end up creating the duplicate this change exists to prevent.
   */
  it("asks for more than the route's default page of matches", async () => {
    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("perez");

    expect(fetchMock.mock.calls[0][0]).toContain("pageSize=50");
  });

  it("says how many customers matched when more matched than are shown", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ customers: [row({ id: "c-1" }), row({ id: "c-2" })], total: 364 }),
    );

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("perez");

    expect(screen.getByText(/364 clientes coinciden/i)).toBeInTheDocument();
  });

  /**
   * The same hole the failed-search fix closed, left open one branch over: the
   * rows render only when there ARE rows and the create action only with
   * `customers.write`, so a reader searching a name that does not exist saw a
   * search box and nothing else. "Nothing rendered" must never be how this
   * component says "no match" — that is indistinguishable from "still typing".
   */
  it("says there are no matches even when the user cannot create a customer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ customers: [], total: 0 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("nadie");

    expect(screen.getByText(/sin coincidencias/i)).toBeInTheDocument();
    expect(screen.queryByText(/crear cliente nuevo/i)).not.toBeInTheDocument();
  });

  it("does not claim truncation when every match is on screen", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ customers: [row({ id: "c-1" }), row({ id: "c-2" })], total: 2 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer={false} onSelect={vi.fn()} />);
    await typeAndDebounce("perez");

    expect(screen.queryByText(/coinciden/i)).not.toBeInTheDocument();
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

  /**
   * D6 / spec "Customer Selection Clear and Explicit Deselect". No test
   * clicked "Seleccionar" and then looked back at the search box:
   * `handleSelect` set `selected` and nothing else, so the term, the result
   * rows, the truncation notice and the near-match notice all stayed on
   * screen underneath the banner announcing the pick.
   */
  it("clears the search term, the results and the near-match state when a customer is selected", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ customers: [row({ id: "c-near", name: "Juan Cerca" })], total: 364, relaxedFrom: "Juan" }),
    );

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("Juan Alberto");
    expect(screen.getByText(/364 clientes coinciden/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Seleccionar Juan Cerca/i }));

    expect(searchInput()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Seleccionar Juan Cerca/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/364 clientes coinciden/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin coincidencias exactas/i)).not.toBeInTheDocument();
    // `hasSearched` on its own: left true with the rows cleared, the picker
    // would answer the pick with "Sin coincidencias para esa búsqueda."
    //
    // Measured limit, stated so nobody reads more coverage into this than it
    // has: mutation proves only `setTerm("")` and `setHasSearched(false)`.
    // Deleting `setResults`, `setTotal` or `setRelaxedFrom` from the handler
    // leaves this test green, because every render path that would show them
    // is gated on `hasSearched`. Those three assertions pin the rendered
    // outcome, which is real; they are not evidence about those setters.
    expect(screen.queryByText(/sin coincidencias para esa búsqueda/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /crear cliente nuevo/i })).not.toBeInTheDocument();
  });

  /**
   * AGENTS.md's 44x44 floor binds here — workshop tablets, and the one
   * standing waiver is the pointer-only sidebar rail. `size="sm"` is 32px,
   * so the class is carried explicitly. jsdom measures nothing, so this
   * pins the class; the rendered height is the browser check's job.
   */
  it("offers a deselect control at the 44x44 hit-target floor when onDeselect is given", () => {
    const onDeselect = vi.fn();

    render(
      <CustomerPicker
        selectedCustomer={row({ id: "c-sel", name: "Ya Elegido" })}
        canCreateCustomer={false}
        onSelect={vi.fn()}
        onDeselect={onDeselect}
      />,
    );

    const control = screen.getByRole("button", { name: /quitar cliente/i });
    expect(control.className).toContain("min-h-11");
    expect(control.className).toContain("min-w-11");

    fireEvent.click(control);

    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ya Elegido")).not.toBeInTheDocument();
  });

  /**
   * Edit mode renders no deselect: `clienteId` is not patchable, so offering
   * "quitar" there would promise what PATCH /api/service-orders/[id] refuses.
   * `ServiceOrderForm` expresses that by passing no `onDeselect` at all.
   */
  it("renders no deselect control when onDeselect is absent", () => {
    render(
      <CustomerPicker
        selectedCustomer={row({ id: "c-sel", name: "Ya Elegido" })}
        canCreateCustomer={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Ya Elegido")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quitar cliente/i })).not.toBeInTheDocument();
  });

  it("shows only the create action when there are zero exact and zero near matches", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ customers: [], total: 0 }));

    render(<CustomerPicker selectedCustomer={null} canCreateCustomer onSelect={vi.fn()} />);
    await typeAndDebounce("nadie-existe");

    expect(screen.getByRole("button", { name: /crear cliente nuevo/i })).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });
});
