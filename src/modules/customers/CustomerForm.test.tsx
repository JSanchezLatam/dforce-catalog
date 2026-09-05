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

/**
 * The edit dialog is the longest one in the app: a customer with several
 * vehicles renders more than `DialogContent`'s `max-h-[85vh]` cap allows. The
 * cap was there; the scroll container was not, so the overflow rendered
 * OUTSIDE the dialog's surface, over the page behind it.
 *
 * jsdom has no layout, so these assert the STRUCTURE that makes the browser
 * scroll rather than a measured overflow: which element is the scroll box, and
 * which controls are deliberately outside it. That is the part that regressed
 * and the part a refactor can silently undo.
 */
describe("CustomerForm — long dialog scrolling", () => {
  it("renders the form body inside a scroll container", async () => {
    const user = userEvent.setup();
    render(
      <CustomerForm
        cliente={CLIENTE}
        vehicles={[vehiculo({ id: "v1" }), vehiculo({ id: "v2", plate: "BBB222" }), vehiculo({ id: "v3", plate: "CCC333" })]}
      />,
    );
    await open(user, "Editar");

    const body = document.querySelector('[data-slot="dialog-body"]');
    expect(body).not.toBeNull();
    expect(body!.className).toContain("overflow-y-auto");
    // Without `min-h-0` a flex item refuses to shrink below its content, which
    // silently disables the overflow — the cap holds and nothing scrolls.
    expect(body!.className).toContain("min-h-0");
    expect(body).toContainElement(vehicleGroup(3));
  });

  it("keeps Guardar and the dialog title out of the scrolling region", async () => {
    const user = userEvent.setup();
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo()]} />);
    await open(user, "Editar");

    const body = document.querySelector('[data-slot="dialog-body"]')!;
    // A Guardar button that scrolls out of reach is a different bug, not a fix.
    expect(body).not.toContainElement(screen.getByRole("button", { name: "Guardar" }));
    expect(body).not.toContainElement(screen.getByRole("button", { name: "Cancelar" }));
    expect(body).not.toContainElement(screen.getByText("Editar cliente"));
  });
});

/**
 * Two different operations, deliberately not one control (defect 2):
 * "Quitar" soft-deletes — the car left the customer, the row survives because
 * its service history must. "Eliminar definitivamente" removes the row — a
 * typo'd plate, a duplicate, something that should never have existed.
 */
describe("CustomerForm — permanent vehicle deletion", () => {
  async function openEditWith(user: ReturnType<typeof userEvent.setup>, vehicles: Vehiculo[]) {
    render(<CustomerForm cliente={CLIENTE} vehicles={vehicles} canDeleteVehicle />);
    await open(user, "Editar");
  }

  /**
   * Permanent deletion is administrador-only (`customers.deleteVehicle`), so
   * the control has to disappear for a tecnico — the API refuses the request
   * either way, but a button that always 403s is a worse answer than no
   * button. The prop defaults to DENY: a caller that forgets to pass it hides
   * the button, which is the harmless failure. The reverse default would show
   * an unauthorized destructive control on every page that forgot.
   */
  it("hides both deletion controls when the grant is absent, keeping deactivation", async () => {
    const user = userEvent.setup();
    render(<CustomerForm cliente={CLIENTE} vehicles={[vehiculo(), vehiculo({ id: "v2", deactivatedAt: new Date() })]} />);
    await open(user, "Editar");

    expect(screen.queryByRole("button", { name: /definitivamente/ })).not.toBeInTheDocument();
    // Deactivation is reversible and stays with every tecnico.
    expect(screen.getByRole("button", { name: "Quitar vehículo 1" })).toBeInTheDocument();
  });

  it("offers deletion alongside deactivation on a saved vehicle, with copy that cannot be confused", async () => {
    const user = userEvent.setup();
    await openEditWith(user, [vehiculo()]);

    const group = vehicleGroup(1);
    expect(within(group).getByRole("button", { name: "Quitar vehículo 1" })).toHaveTextContent(/^Quitar$/);
    expect(
      within(group).getByRole("button", { name: "Eliminar vehículo 1 definitivamente" }),
    ).toHaveTextContent(/^Eliminar definitivamente$/);
  });

  it("offers deletion on a deactivated vehicle too — otherwise a typo'd plate stays forever once quitado", async () => {
    const user = userEvent.setup();
    await openEditWith(user, [vehiculo({ deactivatedAt: new Date("2026-02-01") })]);

    const group = vehicleGroup(1);
    expect(within(group).getByRole("button", { name: "Restaurar vehículo 1" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Eliminar vehículo 1 definitivamente" })).toBeInTheDocument();
  });

  it("asks for confirmation before removing anything, naming the plate and the reversible alternative", async () => {
    const user = userEvent.setup();
    await openEditWith(user, [vehiculo()]);

    await user.click(screen.getByRole("button", { name: "Eliminar vehículo 1 definitivamente" }));

    expect(screen.getByText("Eliminar vehículo definitivamente")).toBeInTheDocument();
    expect(screen.getByText(/Se va a borrar el vehículo ABC111/)).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/i)).toBeInTheDocument();
    // That asking is not doing is proven by the next case, not here: the
    // confirmation is a modal, so while it is open the form behind it is inert
    // and its vehicle rows are correctly absent from the accessibility tree.
  });

  it("leaves the row untouched when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { cliente: { id: "c1" } } });
    await openEditWith(user, [vehiculo()]);

    await user.click(screen.getByRole("button", { name: "Eliminar vehículo 1 definitivamente" }));
    await user.click(screen.getByRole("button", { name: "Cancelar eliminación" }));

    expect(screen.queryByText("Eliminar vehículo definitivamente")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).vehicles).toEqual([{ id: "v1", plate: "ABC111", deactivated: false }]);
  });

  it("sends `deleted: true` for a confirmed deletion and drops the row from the form", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { cliente: { id: "c1" } } });
    await openEditWith(user, [vehiculo({ id: "v1" }), vehiculo({ id: "v2", plate: "BBB222" })]);

    await user.click(screen.getByRole("button", { name: "Eliminar vehículo 1 definitivamente" }));
    await user.click(screen.getByRole("button", { name: "Eliminar definitivamente" }));

    // The surviving vehicle renumbers to 1 — the display index is a position,
    // not an identity, exactly as `Quitar` on a never-saved row already behaves.
    expect(within(vehicleGroup(1)).getByLabelText("Placa")).toHaveValue("BBB222");
    expect(screen.queryByDisplayValue("ABC111")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Deletions ride at the END of the array so an active row's index — the
    // slot a server-side `vehicles.<i>.plate` error names — never shifts.
    expect(bodyOf(fetchMock).vehicles).toEqual([
      { id: "v2", plate: "BBB222", deactivated: false },
      { id: "v1", deleted: true },
    ]);
  });

  it("drops a never-saved row outright instead of sending a delete for an id the server has never seen", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch({ status: 200, body: { cliente: { id: "c1" } } });
    await openEditWith(user, []);

    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.click(screen.getByRole("button", { name: "Eliminar vehículo 1 definitivamente" }));
    await user.click(screen.getByRole("button", { name: "Eliminar definitivamente" }));

    expect(screen.queryByRole("group", { name: /vehículo/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock).vehicles).toEqual([]);
  });
});

/**
 * R18 (rewritten) — a phone can legitimately belong to two people. The `409`
 * still refuses the first attempt; what these cover is the way past it.
 */
describe("CustomerForm — shared phone confirmation", () => {
  /** Two responses in order: the refusal, then the save that follows the confirmation. */
  function mockFetchSequence(...responses: { status: number; body?: unknown }[]) {
    const fetchMock = vi.fn();
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body ?? {},
      });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const DUPLICATE = { status: 409, body: { error: "duplicate_phone", existingClienteId: "existing-1" } };

  async function openCreateAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    render(<CustomerForm />);
    await open(user, "Nuevo cliente");
    await user.type(screen.getByLabelText("Nombre"), "Ana Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
  }

  it("links to the existing customer instead of printing a bare path", async () => {
    const user = userEvent.setup();
    mockFetchSequence(DUPLICATE);

    await openCreateAndSubmit(user);

    const link = await screen.findByRole("link", { name: /cliente existente/i });
    expect(link).toHaveAttribute("href", "/customers/existing-1");
  });

  it("saves once the operator confirms the number is shared", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence(DUPLICATE, { status: 201, body: { cliente: { id: "c9" } } });

    await openCreateAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Guardar igual" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock, 0).allowDuplicatePhone).toBeUndefined();
    expect(bodyOf(fetchMock, 1).allowDuplicatePhone).toBe(true);
  });

  // The confirmation answers ONE attempt. Left in state, the next save would
  // carry it silently and the refusal would never fire again for this form.
  it("does not carry the confirmation into a later save", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence(
      DUPLICATE,
      { status: 201, body: { cliente: { id: "c9" } } },
      DUPLICATE,
    );

    await openCreateAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Guardar igual" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The dialog closed on the save above; reopening starts a fresh attempt.
    await open(user, "Nuevo cliente");
    await user.type(screen.getByLabelText("Nombre"), "Otra Persona");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOf(fetchMock, 2).allowDuplicatePhone).toBeUndefined();
  });

  // Correcting the phone is the other way out of the refusal, and it must not
  // leave the confirmation armed behind it.
  it("drops the confirmation when the phone is corrected instead", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchSequence(DUPLICATE, { status: 201, body: { cliente: { id: "c9" } } });

    await openCreateAndSubmit(user);
    await screen.findByRole("button", { name: "Guardar igual" });

    await user.clear(screen.getByLabelText("Teléfono"));
    await user.type(screen.getByLabelText("Teléfono"), "+525599998888");
    expect(screen.queryByRole("button", { name: "Guardar igual" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock, 1).allowDuplicatePhone).toBeUndefined();
  });
});

/**
 * R20/D5 — the route answers 409 for TWO different reasons now. The form used
 * to arm the shared-phone block unconditionally, so the deactivated case set
 * `undefined`, rendered nothing, and left the operator watching a dialog that
 * did not move.
 */
describe("CustomerForm — a deactivated customer's 409", () => {
  function mockFetchOnce(response: { status: number; body?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("says the record is deactivated instead of showing nothing at all", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ status: 409, body: { error: "cliente_deactivated" } });
    render(<CustomerForm cliente={CLIENTE} vehicles={[]} />);

    await open(user, "Editar");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/desactivado/i);
    // The shared-phone way out must NOT appear: there is no number to confirm.
    expect(screen.queryByRole("button", { name: "Guardar igual" })).not.toBeInTheDocument();
  });

  it("still arms the shared-phone confirmation for the other 409", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ status: 409, body: { error: "duplicate_phone", existingClienteId: "existing-1" } });
    render(<CustomerForm cliente={CLIENTE} vehicles={[]} />);

    await open(user, "Editar");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("button", { name: "Guardar igual" })).toBeInTheDocument();
  });
});
