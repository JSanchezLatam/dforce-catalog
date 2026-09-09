/**
 * Component tests for `VehicleQuickForm` (jsdom — `.test.tsx` routes to the
 * `jsdom` project, see AGENTS.md). Mirrors `CustomerForm.test.tsx`'s pattern:
 * `userEvent`, a stubbed `fetch`, and assertions on the BODY that went out.
 *
 * The first test below is the reason this component exists at all (design D4).
 * `ClienteListItem` does not carry `whatsappOptOut`/`emailOptOut`, and
 * `CustomerForm.buildPayload` always resends both from form state — so
 * reusing `CustomerForm` here would write the form's defaults over a
 * customer's real consent. AGENTS.md: those two booleans are "legally
 * distinct consent regimes, never collapse them." This form cannot do it,
 * because it has no consent field to send; that test is what keeps it that
 * way when someone decides to "simplify" the two forms back together.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Vehiculo } from "@/shared/db/schema";
import { VehicleQuickForm } from "./VehicleQuickForm";

function vehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v-new",
    clienteId: "c1",
    make: null,
    model: null,
    year: null,
    plate: "NEW111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

async function openAndFill(
  user: ReturnType<typeof userEvent.setup>,
  fields: { placa?: string; marca?: string; modelo?: string; año?: string } = { placa: "NEW111" },
) {
  await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
  if (fields.placa) await user.type(screen.getByLabelText("Placa"), fields.placa);
  if (fields.marca) await user.type(screen.getByLabelText("Marca"), fields.marca);
  if (fields.modelo) await user.type(screen.getByLabelText("Modelo"), fields.modelo);
  if (fields.año) await user.type(screen.getByLabelText("Año"), fields.año);
  await user.click(screen.getByRole("button", { name: "Guardar vehículo" }));
}

describe("VehicleQuickForm (D4 — a vehicle-only form, by construction)", () => {
  it("sends only plate, make, model and year — no whatsappOptOut, no emailOptOut, no cliente field at all", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { vehiculo: vehiculo() } });
    render(<VehicleQuickForm clienteId="c1" onCreated={vi.fn()} />);

    await openAndFill(user, { placa: "NEW111", marca: "Toyota" });

    expect(fetchMock).toHaveBeenCalledWith("/api/customers/c1/vehicles", expect.objectContaining({ method: "POST" }));
    // `toEqual`, never `objectContaining`: the point is what is ABSENT.
    expect(Object.keys(bodyOf(fetchMock)).sort()).toEqual(["make", "plate"]);
  });

  // D10 — `validateVehiculoInput` keeps `year` only when it is already a
  // number, and the route now refuses a string rather than dropping it. The
  // form's half of that ruling is this coercion, the same `Number(...)`
  // `CustomerForm.buildPayload` already does.
  it("coerces año to a number before sending it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { vehiculo: vehiculo({ year: 2019 }) } });
    render(<VehicleQuickForm clienteId="c1" onCreated={vi.fn()} />);

    await openAndFill(user, { placa: "NEW111", año: "2019" });

    expect(bodyOf(fetchMock).year).toBe(2019);
  });

  it("hands the new vehicle's id to onCreated", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 201, body: { vehiculo: vehiculo({ id: "v-creado" }) } });
    const onCreated = vi.fn();
    render(<VehicleQuickForm clienteId="c1" onCreated={onCreated} />);

    await openAndFill(user);

    expect(onCreated).toHaveBeenCalledWith("v-creado");
  });

  it("renders the server's field error instead of closing", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 400, body: { errors: { plate: "La placa es obligatoria" } } });
    const onCreated = vi.fn();
    render(<VehicleQuickForm clienteId="c1" onCreated={onCreated} />);

    await openAndFill(user, {});

    expect(await screen.findByText("La placa es obligatoria")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  /**
   * The route answers a 409 as `{ error: "cliente_deactivated" }` — a single
   * STRING, no `errors` map — so reading `body.errors` alone lands this on the
   * generic "Intentalo de nuevo". The refusal is DETERMINISTIC: retrying
   * returns it forever. `ServiceOrderForm` and `CustomerForm` each shipped
   * this same defect once and each carries a comment saying so.
   */
  it("names the deactivation on a 409 instead of telling the operator to retry", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 409, body: { error: "cliente_deactivated" } });
    const onCreated = vi.fn();
    render(<VehicleQuickForm clienteId="c1" onCreated={onCreated} />);

    await openAndFill(user);

    expect(await screen.findByText(/fue desactivado/i)).toBeInTheDocument();
    expect(screen.queryByText(/intentalo de nuevo/i)).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("reports a 404 without inventing a deactivation that did not happen", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 404, body: { error: "not_found" } });
    render(<VehicleQuickForm clienteId="c1" onCreated={vi.fn()} />);

    await openAndFill(user);

    expect(await screen.findByText("No se pudo agregar el vehículo.")).toBeInTheDocument();
    expect(screen.queryByText(/fue desactivado/i)).not.toBeInTheDocument();
  });

  it("reports a failed request rather than leaving the operator in silence", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<VehicleQuickForm clienteId="c1" onCreated={vi.fn()} />);

    await openAndFill(user);

    expect(await screen.findByText(/no se pudo conectar/i)).toBeInTheDocument();
  });
});
