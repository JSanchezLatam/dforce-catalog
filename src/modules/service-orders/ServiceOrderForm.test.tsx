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

function openEditDialog() {
  fireEvent.click(screen.getByRole("button", { name: /editar orden/i }));
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

  /**
   * Category + notes wiring (C4, task 2.4). Category is required (schema NOT
   * NULL) and offered in BOTH modes; the 3 note fields are technician
   * findings that only exist once a technician has examined the vehicle, so
   * they render `isEdit &&`-gated (spec §"Category and Completion Notes
   * Editing").
   */
  describe("category + notes (C4, task 2.4)", () => {
    function categorySelect(): HTMLSelectElement {
      return screen.getByLabelText(/categoría/i) as HTMLSelectElement;
    }

    it("offers all 5 categories in create mode, with REVISADO as a peer option, no distinct treatment", () => {
      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();

      const options = Array.from(categorySelect().options).map((o) => o.value);
      expect(options).toEqual(["instalacion", "mant_preventivo", "mant_correctivo", "reparacion", "revisado"]);
    });

    it("does not render note fields in create mode", () => {
      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();

      expect(screen.queryByLabelText(/hallazgos/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/recomendaciones/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/observaciones/i)).not.toBeInTheDocument();
    });

    it("renders the category select AND the 3 note fields in edit mode, pre-filled from the order", () => {
      render(
        <ServiceOrderForm
          products={[]}
          order={
            {
              id: "o1",
              clienteId: "c-a",
              vehiculoId: "v-a",
              categoria: "mant_preventivo",
              description: "x",
              hallazgos: "Correa floja",
              recomendaciones: "Ajustar tensión",
              observaciones: "Revisar en 3 meses",
            } as never
          }
          canCreateCustomer={false}
        />,
      );
      openEditDialog();

      expect(categorySelect().value).toBe("mant_preventivo");
      expect(screen.getByLabelText(/hallazgos/i)).toHaveValue("Correa floja");
      expect(screen.getByLabelText(/recomendaciones/i)).toHaveValue("Ajustar tensión");
      expect(screen.getByLabelText(/observaciones/i)).toHaveValue("Revisar en 3 meses");
    });

    it("includes categoria in the create-mode POST body", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow()] }));
        return Promise.resolve(jsonResponse({ orden: { id: "o1" } }));
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();
      await flush();
      fireEvent.change(vehicleSelect(), { target: { value: "v-a" } });
      fireEvent.change(categorySelect(), { target: { value: "revisado" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      const call = fetchMock.mock.calls.find(([url]) => url === "/api/service-orders")!;
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.categoria).toBe("revisado");
    });

    it("includes categoria and the 3 notes in the edit-mode PATCH body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ orden: { id: "o1" } }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ServiceOrderForm
          products={[]}
          order={{ id: "o1", clienteId: "c-a", categoria: "instalacion" } as never}
          canCreateCustomer={false}
        />,
      );
      openEditDialog();
      fireEvent.change(categorySelect(), { target: { value: "reparacion" } });
      fireEvent.change(screen.getByLabelText(/hallazgos/i), { target: { value: "Fuga detectada" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/service-orders/o1")!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({ categoria: "reparacion", hallazgos: "Fuga detectada" });
    });
  });
});
