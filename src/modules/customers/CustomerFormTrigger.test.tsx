/**
 * The wrapper exists because a Server Component cannot hand a function across
 * the RSC boundary, so it owns everything that has to happen after a save —
 * `router.refresh()` and the confirmation the operator reads.
 *
 * `CustomerForm` is driven for real rather than stubbed: a fake form would
 * prove only that a callback fires, and what is under test here is which of
 * the two messages the wrapper picks. Create and edit differ by one prop.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { CustomerFormTrigger } from "./CustomerFormTrigger";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const CLIENTE = {
  id: "c1",
  name: "Juan Pérez",
  phone: "+525512345678",
  email: null,
  whatsappOptOut: false,
  emailOptOut: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
} as unknown as Cliente;

const VEHICULO = {
  id: "v1",
  clienteId: "c1",
  make: null,
  model: null,
  year: null,
  plate: "ABC111",
  deactivatedAt: null,
  createdAt: new Date("2026-01-01"),
} as unknown as Vehiculo;

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ cliente: { id: "c1" } }) }),
  );
}

/** The real provider, not a fake: it portals into `document.body`, which is what `screen` queries. */
function renderTrigger(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("CustomerFormTrigger — a save the operator can see", () => {
  it("says the customer was created after a create", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderTrigger(<CustomerFormTrigger />);

    await user.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    await user.type(screen.getByLabelText("Nombre"), "Juan Pérez");
    await user.type(screen.getByLabelText("Teléfono"), "+525512345678");
    await user.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await user.type(
      within(screen.getByRole("group", { name: "Vehículo 1" })).getByLabelText("Placa"),
      "NEW111",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Cliente creado")).toBeInTheDocument();
    // The edit copy is the wrong one here, and `cliente` is the only thing
    // that tells them apart.
    expect(screen.queryByText("Cliente actualizado")).not.toBeInTheDocument();
  });

  it("says the customer was updated after an edit", async () => {
    const user = userEvent.setup();
    mockFetch();
    renderTrigger(<CustomerFormTrigger cliente={CLIENTE} vehicles={[VEHICULO]} />);

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Cliente actualizado")).toBeInTheDocument();
    expect(screen.queryByText("Cliente creado")).not.toBeInTheDocument();
  });
});
