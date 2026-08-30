/**
 * Component tests for `CustomerForm`'s vehicle collection (vehicles-one-to-many,
 * C3, slice 3). Mirrors `UserForm.test.tsx`'s pattern: `userEvent`, a stubbed
 * `fetch`, and `within()` to scope each vehicle card's repeated field labels
 * ("Placa" appears once per row, so a bare `getByLabelText` would throw with
 * more than one row on screen).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { CustomerForm } from "./CustomerForm";

const CLIENTE: Cliente = {
  id: "c1",
  name: "Juan Pérez",
  phone: "+525512345678",
  email: null,
  whatsappOptOut: false,
  emailOptOut: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
} as unknown as Cliente;

function vehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: null,
    model: null,
    year: null,
    plate: "ABC111",
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

async function open(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: label }));
}

function vehicleGroup(index: number) {
  return screen.getByRole("group", { name: `Vehículo ${index}` });
}

describe("CustomerForm — vehicle collection (create)", () => {
  it("shows the Spanish 'Vehículos' section with no rows and no vehicle by default", async () => {
    const user = userEvent.setup();
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    expect(screen.getByText("Vehículos")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /vehículo/i })).not.toBeInTheDocument();
  });

  /**
   * The `vehicles` prop's docstring promises it is honoured only in edit mode.
   * Without the guard in `toFormState` it was mapped regardless of `cliente`,
   * so these rows would render, `buildPayload` would POST ids belonging to
   * another customer, and `planVehiculoReconcile` would reject the whole
   * request as foreign-id ownership. No caller passes them today; this pins
   * the promise so none can start.
   */
  it("ignores a vehicles prop in create mode, as its docstring promises", async () => {
    const user = userEvent.setup();
    render(<CustomerForm vehicles={[vehiculo({ id: "v-otro", plate: "ZZZ999" })]} />);
    await open(user, "Nuevo cliente");

    expect(screen.queryByRole("group", { name: /vehículo/i })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("ZZZ999")).not.toBeInTheDocument();
  });

  it("adds a vehicle row with its own Placa/Marca/Modelo/Año fields", async () => {
    const user = userEvent.setup();
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));

    const group = vehicleGroup(1);
    expect(within(group).getByLabelText("Placa")).toBeInTheDocument();
    expect(within(group).getByLabelText("Marca")).toBeInTheDocument();
    expect(within(group).getByLabelText("Modelo")).toBeInTheDocument();
    expect(within(group).getByLabelText("Año")).toBeInTheDocument();
  });

  it("fully removes a never-saved row instead of marking it deactivated", async () => {
    const user = userEvent.setup();
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.click(screen.getByRole("button", { name: "Quitar vehículo 1" }));

    expect(screen.queryByRole("group", { name: /vehículo/i })).not.toBeInTheDocument();
  });

  it("sends vehicles: [] when saving with zero rows", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { cliente: { id: "c1" } } });
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).vehicles).toEqual([]);
  });

  it("sends each added vehicle's fields, omitting blanks", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 201, body: { cliente: { id: "c1" } } });
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    const group = vehicleGroup(1);
    await user.type(within(group).getByLabelText("Placa"), "ABC-123");
    await user.type(within(group).getByLabelText("Marca"), "Toyota");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).vehicles).toEqual([{ plate: "ABC-123", make: "Toyota" }]);
  });

  it("shows a plate error on the row it belongs to, independent of a valid sibling", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      status: 400,
      body: { errors: { "vehicles.1.plate": "La placa es obligatoria" } },
    });
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.type(within(vehicleGroup(1)).getByLabelText("Placa"), "ABC-123");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(within(vehicleGroup(2)).getByRole("alert")).toHaveTextContent("La placa es obligatoria");
    expect(within(vehicleGroup(1)).queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The sibling case above cannot fail for the reason its name gives: with no
   * deactivated rows, a row's position ON SCREEN and its position in the
   * SUBMITTED array are the same number, so an implementation that used the
   * display index would pass it too. The divergence `indexedVehicleRows`
   * exists for is only observable with a deactivated row above the erroring
   * one — display index 2, submitted index 0.
   */
  it("keys the plate error by the row's position in the ACTIVE array, not its position on screen", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      status: 400,
      body: { errors: { "vehicles.0.plate": "La placa es obligatoria" } },
    });
    render(
      <CustomerForm
        cliente={CLIENTE}
        vehicles={[vehiculo({ id: "v1", plate: "OLD111", deactivatedAt: new Date("2026-02-01") })]}
      />,
    );
    await open(user, "Editar");

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(within(vehicleGroup(2)).getByRole("alert")).toHaveTextContent("La placa es obligatoria");
  });

  /**
   * A 400 leaves the dialog open holding `vehicles.<i>.*` keys indexed against
   * the array THAT submit sent. Adding or removing a row recomputes every
   * position while those keys stay put, so a stale error repaints itself onto
   * whichever car now sits at that index — a different one. Nothing else
   * clears them: `handleSubmit` fires on the next submit, `handleOpenChange`
   * on open.
   */
  it("drops stale per-row errors when the collection changes under them", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      status: 400,
      body: { errors: { "vehicles.0.plate": "La placa es obligatoria" } },
    });
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(within(vehicleGroup(1)).getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));

    expect(within(vehicleGroup(1)).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(vehicleGroup(2)).queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * `validateVehiculosInput` and `planVehiculoReconcile` both throw under the
   * bare `vehicles` key. Without a slot for it a 400 carrying only that key
   * leaves the dialog open with nothing on screen: the staff member presses
   * Guardar and nothing at all happens.
   */
  it("renders a collection-level vehicles error, not just per-row plate errors", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({
      status: 400,
      body: { errors: { vehicles: "Vehículos debe ser una lista" } },
    });
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("Vehículos debe ser una lista");
  });

  /** The row number is a test/screen-reader handle, not copy a staff member should read. */
  it("keeps the row number out of the visible button copy while it still names the button", async () => {
    const user = userEvent.setup();
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));

    const remove = screen.getByRole("button", { name: "Quitar vehículo 1" });
    expect(remove).toHaveTextContent(/^Quitar$/);
  });

  it("passes the just-submitted plates to onSaved, not a hardcoded empty array", async () => {
    const user = userEvent.setup();
    mockFetch({ status: 201, body: { cliente: { id: "c1" } } });
    const onSaved = vi.fn();
    render(<CustomerForm onSaved={onSaved} />);
    await open(user, "Nuevo cliente");

    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.type(within(vehicleGroup(1)).getByLabelText("Placa"), "NEW111");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith({ id: "c1" }, ["NEW111"]);
  });
});

describe("CustomerForm — vehicle collection (edit)", () => {
  it("prefills each existing vehicle's fields", async () => {
    const user = userEvent.setup();
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo({ make: "Toyota", year: 2020 })]} />);
    await open(user, "Editar");

    const group = vehicleGroup(1);
    expect(within(group).getByLabelText("Placa")).toHaveValue("ABC111");
    expect(within(group).getByLabelText("Marca")).toHaveValue("Toyota");
    expect(within(group).getByLabelText("Año")).toHaveValue(2020);
  });

  it("deactivating an existing vehicle omits it from the saved payload instead of deleting the row", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { cliente: { id: "c1" } } });
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo()]} />);
    await open(user, "Editar");

    await user.click(screen.getByRole("button", { name: "Quitar vehículo 1" }));
    expect(screen.getByText("Vehículo desactivado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).vehicles).toEqual([]);
  });

  it("restoring a deactivated vehicle resends its id, and it stays visible throughout", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { cliente: { id: "c1" } } });
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo({ deactivatedAt: new Date("2026-02-01") })]} />);
    await open(user, "Editar");

    // "Stays visible" (owner's design direction) — no show/hide toggle needed
    // for a single customer's small collection, unlike UsersTable's list-wide one.
    expect(vehicleGroup(1)).toBeInTheDocument();
    expect(screen.getByText("Vehículo desactivado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restaurar vehículo 1" }));
    expect(screen.queryByText("Vehículo desactivado")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // `deactivated: false` is the ASK. The server no longer reactivates a row
    // just because the payload included it, so a restore has to say so.
    expect(bodyOf(fetchMock).vehicles).toEqual([{ id: "v1", plate: "ABC111", deactivated: false }]);
  });

  /**
   * A deactivated vehicle must read as secondary at a glance, not as an
   * identical card with an extra caption: muted surface and foreground, and a
   * compact row — plate, state, restore — instead of the full edit form.
   * Nothing on a deactivated row is editable anyway, so its four inputs were
   * pure vertical weight on the least important row on screen — they are no
   * longer rendered at all.
   */
  it("collapses a deactivated vehicle to a muted compact row instead of a full card", async () => {
    const user = userEvent.setup();
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo({ deactivatedAt: new Date("2026-02-01") })]} />);
    await open(user, "Editar");

    const group = vehicleGroup(1);
    expect(within(group).queryByLabelText("Placa")).not.toBeInTheDocument();
    expect(within(group).queryByLabelText("Marca")).not.toBeInTheDocument();
    expect(within(group).getByText("ABC111")).toBeInTheDocument();
    expect(group.className).toContain("bg-muted");
    expect(group.className).toContain("text-muted-foreground");
    expect(within(group).getByRole("button", { name: "Restaurar vehículo 1" })).toHaveTextContent(/^Restaurar$/);
  });

  it("brings the editable fields back when the vehicle is restored", async () => {
    const user = userEvent.setup();
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo({ deactivatedAt: new Date("2026-02-01") })]} />);
    await open(user, "Editar");

    await user.click(screen.getByRole("button", { name: "Restaurar vehículo 1" }));
    expect(within(vehicleGroup(1)).getByLabelText("Placa")).toHaveValue("ABC111");
  });
});
