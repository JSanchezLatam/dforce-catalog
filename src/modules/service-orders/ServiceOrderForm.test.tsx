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
  deactivatedAt: null,
  plates: ["ABC111"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function clienteRow(overrides: Partial<ClienteListItem> = {}): ClienteListItem {
  return {
    id: "c-a",
    deactivatedAt: null,
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

function categorySelect(): HTMLSelectElement {
  return screen.getByLabelText(/categoría/i) as HTMLSelectElement;
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
      // No fetch happens at mount — the effect returns early while `open` is
      // false. What this pins is the opposite: opening must be what triggers
      // the load, because the effect owns `vehicles`/`vehiclesLoading` and
      // `open` is in its deps. Before that ownership existed, `resetForm`
      // emptied the list on open and no dependency ever changed to refill it.
      openDialog();
      await flush();

      expect(vehicleSelect()).not.toBeDisabled();
      expect(screen.getByRole("option", { name: /AAA111/ })).toBeInTheDocument();

      fireEvent.change(vehicleSelect(), { target: { value: "v-pre" } });
      fireEvent.change(categorySelect(), { target: { value: "revisado" } });
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
     * GGA round 5, finding 2. The load failure and the zero-vehicles hint are
     * the only explanation for a disabled dropdown and a dead Guardar, and
     * neither reached a screen reader — the adjacent field error announces,
     * these did not. The failure is an alert; the empty garage is guidance,
     * so it is wired to the select with aria-describedby instead (next test).
     */
    it("announces the load failure to a screen reader", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.reject(new Error("network down"));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();
      await selectCustomer("Cliente A");

      expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos cargar los vehículos/i);
    });

    it("points the select at the empty-garage hint so it is not silently disabled", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [] }));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();
      await selectCustomer("Cliente A");

      const hint = screen.getByText(/no tiene vehículos activos/i);
      expect(vehicleSelect()).toHaveAttribute("aria-describedby", hint.id);
      expect(hint.id).not.toBe("");
    });

    /**
     * GGA round 3, finding 2. The error message says "probá de nuevo" and
     * nothing in the dialog could. Re-picking the same customer is a no-op
     * (React bails on the identical value), so only closing and reopening
     * recovered — which is not what the copy tells the user to do.
     */
    it("retries the failed load from inside the dialog", async () => {
      let attempt = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) {
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new Error("network down"))
            : Promise.resolve(jsonResponse({ vehicles: [vehiculoRow()] }));
        }
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();
      await selectCustomer("Cliente A");

      expect(screen.getByText(/no pudimos cargar los vehículos/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      await flush();

      expect(screen.queryByText(/no pudimos cargar los vehículos/i)).not.toBeInTheDocument();
      expect(vehicleSelect()).not.toBeDisabled();
      expect(screen.getByRole("option", { name: /AAA111/ })).toBeInTheDocument();
    });

    /**
     * GGA round 4, finding 1. `setErrors(body.errors)` renders only the keys
     * that have a field: `clienteId` and `vehiculoId`. A 400 keyed on anything
     * else — `categoria` today, whatever the API adds tomorrow — set state
     * nobody displays, so the dialog just sat there after Guardar with no
     * message at all. This pins the CLASS, not the one key.
     */
    it("shows an API rejection even when it names a field this form does not render", async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ errors: { unfieldedKey: "Algo no cierra en el servidor" } }),
          } as Response);
        }
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow()] }));
        return Promise.resolve(jsonResponse({ customers: [clienteRow()], total: 1 }));
      });

      render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
      openDialog();
      await selectCustomer("Cliente A");
      fireEvent.change(vehicleSelect(), { target: { value: "v-a" } });
      fireEvent.change(categorySelect(), { target: { value: "revisado" } });

      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      expect(screen.getByText("Algo no cierra en el servidor")).toBeInTheDocument();
    });

    /**
     * GGA round 1, finding 6. An unhandled rejection is the smaller half of
     * this: the visible damage is telling a customer WITH cars to go add one,
     * because a failed request and an empty garage rendered identically.
     */
    it.each([
      ["the network drops", () => Promise.reject(new Error("network down"))],
      ["the API answers 500", () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response)],
      ["the API answers 403", () => Promise.resolve({ ok: false, status: 403, json: async () => ({}) } as Response)],
    ])("does not pass a failed request off as a customer with no vehicles when %s", async (_case, respond) => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return respond();
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
      // Two gates now, not one: the category is required as well.
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

      fireEvent.change(categorySelect(), { target: { value: "revisado" } });
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
    it("offers all 5 categories in create mode, with REVISADO as a peer option, no distinct treatment", () => {
      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();

      // The leading "" is the placeholder create mode now opens on, not a
      // sixth category — it is dropped before comparing so this test keeps
      // asserting the vocabulary rather than the widget's shape.
      const options = Array.from(categorySelect().options)
        .map((o) => o.value)
        .filter(Boolean);
      expect(options).toEqual(["instalacion", "mant_preventivo", "mant_correctivo", "reparacion", "revisado"]);
    });

    /**
     * GGA round 5 on PR #58. Every native control here sets `outline-none`,
     * which defeats the global `*:focus-visible` ring in globals.css —
     * Tailwind's utilities layer wins over base, and `.outline-none` also
     * clears the very variable that rule resolves its style from. The repo's
     * own `input.tsx` always pairs the two; these did not, so four fields in
     * the dialog this WU makes people open after every job were invisible to
     * a keyboard user. Pins the class, not one control.
     */
    it("gives every native control a focus ring, since outline-none kills the global one", () => {
      render(
        <ServiceOrderForm
          products={[]}
          canCreateCustomer={false}
          order={{ id: "o1", clienteId: "c-a", categoria: "instalacion" } as never}
        />,
      );
      openEditDialog();

      const controls = [
        categorySelect(),
        screen.getByLabelText(/hallazgos/i),
        screen.getByLabelText(/recomendaciones/i),
        screen.getByLabelText(/observaciones/i),
      ];
      for (const control of controls) {
        expect(control.className).toContain("outline-none");
        expect(control.className).toContain("focus-visible:ring-3");
      }
    });

    /**
     * The vehicle select lives behind `{!isEdit && …}`, so the edit-mode test
     * above never sees it — and it is the control the original defect was
     * found on, plus the one every NEW order passes through. Today it is safe
     * only because it shares NATIVE_FIELD; inline a class on it and nothing
     * above would go red.
     */
    it("gives the create-mode vehicle select a focus ring too", () => {
      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();

      expect(vehicleSelect().className).toContain("outline-none");
      expect(vehicleSelect().className).toContain("focus-visible:ring-3");
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

    /**
     * Owner decision after GGA round 3 on PR #58. The select used to open on
     * "Instalación", so a technician who never touched it filed the order as
     * one. A MISSING category is visible — the submit is blocked and the user
     * picks. A WRONG one is invisible forever, and REVISADO is Panama's
     * mandatory ATTT inspection, so a mis-filed order makes the vehicle's
     * history lie about something with legal consequence. Same pattern the
     * vehicle field one row above already uses.
     */
    it("starts create mode on a placeholder and blocks submit until a category is chosen", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/vehicles")) return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow()] }));
        return Promise.resolve(jsonResponse({ orden: { id: "o1" } }));
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
      openDialog();
      await flush();

      expect(categorySelect()).toHaveValue("");
      fireEvent.change(vehicleSelect(), { target: { value: "v-a" } });
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

      fireEvent.change(categorySelect(), { target: { value: "revisado" } });
      expect(screen.getByRole("button", { name: "Guardar" })).not.toBeDisabled();
    });

    it("offers no placeholder in edit mode — the order already has a category", async () => {
      render(
        <ServiceOrderForm
          products={[]}
          canCreateCustomer={false}
          order={{ id: "o1", clienteId: "c-a", categoria: "reparacion" } as never}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /editar orden/i }));

      expect(categorySelect()).toHaveValue("reparacion");
      expect(screen.queryByRole("option", { name: /seleccioná un tipo de servicio/i })).not.toBeInTheDocument();
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
      // All three notes, not one. `toMatchObject` is non-exhaustive, so a test
      // that changes only `hallazgos` stays green if someone drops the other
      // two from the PATCH body — and this form is the only thing that puts
      // them on the wire. route.test.ts covers the route's handling of all
      // three; nothing covered the form's wiring of them.
      fireEvent.change(screen.getByLabelText(/hallazgos/i), { target: { value: "Fuga detectada" } });
      fireEvent.change(screen.getByLabelText(/recomendaciones/i), { target: { value: "Cambiar el empaque" } });
      fireEvent.change(screen.getByLabelText(/observaciones/i), { target: { value: "Cliente avisado" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/service-orders/o1")!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({
        categoria: "reparacion",
        hallazgos: "Fuga detectada",
        recomendaciones: "Cambiar el empaque",
        observaciones: "Cliente avisado",
      });
    });
  });

  /**
   * Task 2.10 — the appointmentAt drift, found by GGA round 3 on PR #58 and
   * reproduced in America/Panama before this fix.
   *
   * `toDatetimeLocal` built the input value from `toISOString()`, a UTC wall
   * clock, and `handleSubmit` read it back with `new Date()`, which parses an
   * offset-less date-TIME string as LOCAL. So the input showed 14:00 for an
   * appointment stored at 14:00Z, and saving turned it into 19:00Z. Reopen,
   * save again, 00:00Z the next day. It compounded.
   *
   * The TZ is pinned rather than inherited: on a UTC machine (CI) the
   * assertion below would pass with the bug still in place.
   */
  describe("appointmentAt round-trip (task 2.10)", () => {
    const REAL_TZ = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = "America/Panama";
    });
    afterEach(() => {
      // DELETE, never `= REAL_TZ`. This machine has no TZ set, so REAL_TZ is
      // undefined, and assigning undefined to process.env stores the STRING
      // "undefined" — which Node reads as an invalid zone and falls back to
      // UTC. Restoring that way would leave every later test running on the
      // exact UTC machine this describe pins the zone to avoid.
      if (REAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = REAL_TZ;
    });

    // Non-zero SECONDS on purpose. `updateOrder` compares getTime(), and this
    // input has no seconds field — so an appointment stored at :45 is the only
    // case the client-side omission uniquely defends. A :00 fixture proves the
    // mechanism but not the reason for it.
    const STORED = new Date("2026-03-10T14:00:45Z");

    it("shows the appointment in local wall-clock time, not UTC", () => {
      render(
        <ServiceOrderForm
          products={[]}
          canCreateCustomer={false}
          order={{ id: "o1", clienteId: "c-a", categoria: "instalacion", appointmentAt: STORED } as never}
        />,
      );
      openEditDialog();

      // 14:00Z is 09:00 in Panama (UTC-5). The old code rendered "14:00".
      expect(screen.getByLabelText(/cita/i)).toHaveValue("2026-03-10T09:00");
    });

    it("does not send appointmentAt at all when the user never touched it", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ orden: { id: "o1" } }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ServiceOrderForm
          products={[]}
          canCreateCustomer={false}
          order={{ id: "o1", clienteId: "c-a", categoria: "instalacion", appointmentAt: STORED } as never}
        />,
      );
      openEditDialog();
      fireEvent.change(screen.getByLabelText(/hallazgos/i), { target: { value: "Correa cambiada" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/service-orders/o1")!;
      const body = JSON.parse((init as RequestInit).body as string);
      // Omitted, not merely equal. updateOrder compares getTime() to decide
      // whether to cancel and reschedule the customer's reminder, and the
      // input truncates seconds — so an untouched field that still gets sent
      // reads as a CHANGED appointment for any order stored with seconds.
      expect(body).not.toHaveProperty("appointmentAt");
      expect(body).toMatchObject({ hallazgos: "Correa cambiada" });
    });

    it("still sends appointmentAt, as the right instant, when the user does change it", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ orden: { id: "o1" } }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <ServiceOrderForm
          products={[]}
          canCreateCustomer={false}
          order={{ id: "o1", clienteId: "c-a", categoria: "instalacion", appointmentAt: STORED } as never}
        />,
      );
      openEditDialog();
      fireEvent.change(screen.getByLabelText(/cita/i), { target: { value: "2026-03-10T11:30" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      await flush();

      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/service-orders/o1")!;
      const body = JSON.parse((init as RequestInit).body as string);
      // 11:30 in Panama is 16:30Z.
      expect(body.appointmentAt).toBe("2026-03-10T16:30:00.000Z");
    });
  });
});

/**
 * R20/D5 — `POST /api/service-orders` gained a 409 in this change and this
 * form, its only client, was not touched: the refusal fell through to the
 * generic "Intentalo de nuevo", which sends the operator round a loop that
 * returns the identical answer forever. The wire between the route's mapping
 * and this screen was asserted nowhere.
 */
describe("ServiceOrderForm — a deactivated customer's 409 (R20)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function submitAgainst(response: { status: number; body: unknown }) {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: async () => response.body,
        } as Response);
      }
      if (url.includes("/vehicles")) {
        return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow({ id: "v-pre", clienteId: "c-preseleccionado" })] }));
      }
      return Promise.resolve(jsonResponse({ customers: [], total: 0 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
    openDialog();
    await flush();
    fireEvent.change(vehicleSelect(), { target: { value: "v-pre" } });
    fireEvent.change(categorySelect(), { target: { value: "revisado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await flush();
  }

  it("names the deactivation instead of telling the operator to retry", async () => {
    await submitAgainst({ status: 409, body: { error: "cliente_deactivated" } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/desactivado/i);
    // The generic copy is the defect: this refusal is deterministic, so
    // "Intentalo de nuevo" is an instruction that cannot ever work.
    expect(alert).not.toHaveTextContent(/Intentalo de nuevo/i);
  });

  it("still shows the generic message for a failure that IS worth retrying", async () => {
    await submitAgainst({ status: 500, body: {} });

    expect(screen.getByRole("alert")).toHaveTextContent(/Intentalo de nuevo/i);
  });
});

/**
 * NOT tested here, and PROVEN untestable rather than assumed: that a throwing
 * `onSaved` is not reported as a connection failure.
 *
 * The dialog forms all place their post-success lines outside the `catch` so
 * exactly that cannot happen — but no component test can pin it. `setOpen(false)`
 * runs first, so the wrong message would render into a dialog that is already
 * unmounted. Measured, not reasoned: widening the `catch` to swallow `onSaved`'s
 * throw — the actual defect — and running a test written to catch it, the test
 * PASSES. Nothing distinguishes the two shapes from the DOM.
 *
 * `OrderStatusControls`, `UsersTable` and `ForcedPasswordChangeForm` do pin it,
 * because their error surface survives the post-success line. Those three are
 * the guard for this property.
 */

/**
 * `fetch` REJECTS on a network failure — it does not return a non-ok response
 * — so a `try/finally` with no `catch` re-enables Guardar with nothing on
 * screen and the operator clicks into the same silence. `UserForm` and
 * `CustomerForm` both carry this catch with the same copy, and `UserForm`'s
 * comment records that the defect stranded a blocked user once.
 *
 * This form was the last of the three without it. It is also the one where the
 * silence costs most: the operator has just picked a customer, a vehicle, a
 * category and possibly a parts cart, and a save that vanishes takes all of it
 * with the dialog.
 */
describe("ServiceOrderForm — a network failure has to say so", () => {
  const CONNECTION_ERROR = "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Same scaffold as the 409 describe above, with the POST REJECTING instead. */
  async function submitAgainstNetworkFailure() {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.reject(new TypeError("Failed to fetch"));
      if (url.includes("/vehicles")) {
        return Promise.resolve(jsonResponse({ vehicles: [vehiculoRow({ id: "v-pre", clienteId: "c-preseleccionado" })] }));
      }
      return Promise.resolve(jsonResponse({ customers: [], total: 0 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
    openDialog();
    await flush();
    fireEvent.change(vehicleSelect(), { target: { value: "v-pre" } });
    fireEvent.change(categorySelect(), { target: { value: "revisado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await flush();
  }

  it("tells the operator the order did not go through, and leaves Guardar clickable", async () => {
    await submitAgainstNetworkFailure();

    expect(screen.getByRole("alert")).toHaveTextContent(CONNECTION_ERROR);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  // NOT tested: "the dialog stays open, so nothing typed is thrown away". It
  // is true and it matters — the dialog is the only place the order exists —
  // but no test can prove it here. Without the catch the rejection escapes
  // BEFORE `setOpen(false)` runs, so the dialog stays open either way; the
  // assertion was written, run, and passed against the unfixed component.
  // Deleted rather than kept as a placebo.
});
