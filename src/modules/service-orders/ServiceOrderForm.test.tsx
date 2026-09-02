/**
 * Component tests for `ServiceOrderForm` (jsdom, see AGENTS.md's Component
 * testing section — `.test.tsx` routes to the `jsdom` project). Submit is
 * gated on `clienteId` in create mode, so the seeding of that field from the
 * `selectedCustomer` prop is the behaviour worth proving here.
 *
 * C4 additions (task 1.12): the vehicle picker fetches on customer change and
 * clears the previous selection in the SAME handler (design.md D2's
 * stale-vehicle defect, closed explicitly) — driven through the real
 * `CustomerPicker` search+select flow, same fake-timer debounce pattern as
 * `CustomerPicker.test.tsx`. Uses a native `<select>` (not the base-ui
 * `Select`, which no test in this repo exercises yet and needs jsdom shims
 * this WU has no other reason to add) — see `ServiceOrderForm.tsx`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteListItem } from "@/modules/customers/queries";
import type { Vehiculo } from "@/shared/db/schema";
import { ServiceOrderForm } from "./ServiceOrderForm";

const CUSTOMER: ClienteListItem = {
  id: "c-preseleccionado",
  name: "Ya Elegido",
  phone: "50761111111",
  email: null,
  plates: ["ABC111"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function clienteRow(overrides: Partial<ClienteListItem> = {}): ClienteListItem {
  return {
    id: "c-a",
    name: "Cliente A",
    phone: "50762222222",
    email: null,
    plates: ["AAA111"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function vehiculoRow(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v-a",
    clienteId: "c-a",
    make: "Toyota",
    model: "Corolla",
    year: 2020,
    plate: "AAA111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /nueva orden de servicio/i }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drives the real CustomerPicker's search box + "Seleccionar" button. */
async function selectCustomer(name: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /buscar cliente/i }), { target: { value: name } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Seleccionar ${name}`, "i") }));
  await flush();
}

function vehicleSelect(): HTMLSelectElement {
  return screen.getByLabelText(/vehículo/i) as HTMLSelectElement;
}

describe("ServiceOrderForm", () => {
  // A benign default so any component that fetches on mount/open (the vehicle
  // picker's effect) never hits an undefined `fetch` in tests that don't care
  // about it — overridden per-test/describe below where the fetch IS the point.
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ vehicles: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds clienteId from selectedCustomer, rendering it as already selected", () => {
    render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
    openDialog();

    expect(screen.getByText("Ya Elegido")).toBeInTheDocument();
  });

  it("keeps submit disabled in create mode when no customer was pre-picked", () => {
    render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
    openDialog();

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  describe("vehicle picker (C4, task 1.12)", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      fetchMock = vi.fn((url: string) => {
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow()] }));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    /**
     * GGA round 1, findings 1+5. The pre-picked path is how the customer
     * detail page opens this form, and it had no behavioural coverage: the
     * old test asserted only that the customer's NAME rendered. Opening the
     * dialog runs `resetForm`, which re-set `clienteId` to the value it
     * already had — React bails out on an identical value, so the fetch
     * effect never re-ran while `resetForm` had already emptied the list and
     * pinned `vehiclesLoading` true. Disabled dropdown, no explanation, no
     * way to submit, forever.
     */
    it("loads the pre-picked customer's vehicles when the dialog opens", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/api/customers/c-preseleccionado/vehicles")) {
          return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow({ id: "v-pre", clienteId: "c-preseleccionado" })] }));
        }
        return Promise.resolve(jsonResponse({ customers: [], total: 0 }));
      });

      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      // The mount fetch settles BEFORE the user opens the dialog — the page
      // has been sitting there. Flushing after the click instead would let
      // the in-flight promise repaint the list `resetForm` just cleared, and
      // the bug would hide behind the ordering.
      await flush();
      openDialog();
      await flush();

      expect(vehicleSelect()).not.toBeDisabled();
      expect(screen.getByRole("option", { name: /AAA111/ })).toBeInTheDocument();

      fireEvent.change(vehicleSelect(), { target: { value: "v-pre" } });
      expect(screen.getByRole("button", { name: "Guardar" })).not.toBeDisabled();
    });

    /** GGA round 1, finding 2 — same root cause, reached a second way. */
    it("survives re-picking the customer that is already selected", async () => {
      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();

      await selectCustomer("Cliente A");
      await selectCustomer("Cliente A");

      expect(vehicleSelect()).not.toBeDisabled();
      expect(screen.getByRole("option", { name: /AAA111/ })).toBeInTheDocument();
    });

    /**
     * GGA round 1, finding 6. An unhandled rejection is the smaller half of
     * this: the visible damage is telling a customer WITH cars to go add one,
     * because a failed request and an empty garage rendered identically.
     */
    it("does not pass a failed request off as a customer with no vehicles", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.reject(new Error("network down"));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();
      await selectCustomer("Cliente A");

      expect(screen.queryByText(/no tiene vehículos activos/i)).not.toBeInTheDocument();
      expect(screen.getByText(/no pudimos cargar los vehículos/i)).toBeInTheDocument();
    });

    it("keeps submit disabled until a vehicle is selected, even once a customer is picked", async () => {
      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();

      await selectCustomer("Cliente A");

      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

      fireEvent.change(vehicleSelect(), { target: { value: "v-a" } });
      expect(screen.getByRole("button", { name: "Guardar" })).not.toBeDisabled();
    });

    it("clears the previously selected vehicle when the customer changes, in the same handler as the customer change", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/api/customers/c-a/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow({ id: "v-a" })] }));
        if (url.includes("/api/customers/c-b/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow({ id: "v-b", clienteId: "c-b", plate: "BBB222" })] }));
        return Promise.resolve(
          jsonResponse({ customers: [clienteRow({ id: "c-a", name: "Cliente A" }), clienteRow({ id: "c-b", name: "Cliente B" })], total: 2 }),
        );
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();

      await selectCustomer("Cliente A");
      fireEvent.change(vehicleSelect(), { target: { value: "v-a" } });
      expect(vehicleSelect().value).toBe("v-a");

      await selectCustomer("Cliente B");

      // The clear happens in the SAME synchronous handler as the customer
      // change — before the new vehicle list even arrives — so this must be
      // true regardless of when the fetch resolves.
      expect(vehicleSelect().value).toBe("");
    });

    it("shows a directive Spanish message and keeps submit disabled when the selected customer has zero active vehicles", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [] }));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();

      await selectCustomer("Cliente A");

      expect(screen.getByText(/no tiene vehículos activos/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    });
  });
});
