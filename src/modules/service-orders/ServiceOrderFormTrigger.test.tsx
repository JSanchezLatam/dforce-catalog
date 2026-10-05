/**
 * The trigger's whole job is what happens AFTER a save: `router.refresh()`
 * repaints the server-rendered list, and on a workshop tablet that repaint is
 * indistinguishable from nothing having happened — the dialog closes and the
 * row it wrote may be on another page, under another filter, or below the
 * fold. So the save has to say so out loud.
 *
 * Driven through the REAL `ServiceOrderForm`, not a stub standing in for it:
 * `onSaved` is only reached after the POST/PATCH actually resolves ok, and a
 * fake child calling `onSaved()` on demand would prove the wiring while saying
 * nothing about whether the real form ever gets there.
 *
 * See `.claude/skills/component-testing/SKILL.md` for why this is `.test.tsx`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClienteListItem } from "@/modules/customers/queries";
import type { OrdenServicio, Vehiculo } from "@/shared/db/schema";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { ServiceOrderFormTrigger } from "./ServiceOrderFormTrigger";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const CUSTOMER: ClienteListItem = {
  id: "c-a",
  name: "Cliente A",
  phone: "50761111111",
  email: null,
  deactivatedAt: null,
  plates: ["AAA111"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const VEHICLE: Vehiculo = {
  id: "v-a",
  clienteId: "c-a",
  make: "Toyota",
  model: "Corolla",
  year: 2020,
  plate: "AAA111",
  chasis: null,
  colorPrimario: null,
  colorSecundario: null,
  estilo: null,
  motor: null,
  numeroUnidad: null,
  placaRenovacionMes: null,
  seguroVence: null,
  deactivatedAt: null,
  createdAt: new Date("2026-01-01"),
};

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  push.mockReset();
});

/**
 * The vehicle list for the pre-picked customer, and an ok save for whatever
 * the form sends — POST in create mode, PATCH in edit mode.
 */
function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      return { ok: true, status: 200, json: async () => ({ orden: { id: "o1" } }) } as Response;
    }
    if (String(url).includes("/vehicles")) {
      return { ok: true, status: 200, json: async () => ({ vehicles: [VEHICLE] }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ customers: [], total: 0 }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * A complete `OrdenServicio`, not the four fields this file happens to read.
 * `order as never` stood here, which turned the prop`s declared type into a
 * claim nobody had checked: the component could start reading `status` or
 * `completedAt` and every test would keep passing against an object that never
 * had them. GGA flagged it as the "mock more convenient than reality" pattern
 * AGENTS.md rules out, and the cast was exactly what hid the gap — `tsc` now
 * fails if this fixture drifts from the row.
 */
const EXISTING_ORDER: OrdenServicio = {
  id: "o1",
  clienteId: "c-a",
  vehiculoId: "v-a",
  status: "open",
  categoria: "mant_preventivo",
  description: null,
  appointmentAt: null,
  completedAt: null,
  hallazgos: null,
  recomendaciones: null,
  observaciones: null,
  kilometraje: null,
  nivelCombustible: null,
  bateriaPct: null,
  createdBy: "u1",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};

function renderTrigger(order?: OrdenServicio | null) {
  return render(
    <ToastProvider>
      <ServiceOrderFormTrigger
        order={order}
        selectedCustomer={CUSTOMER}
        canCreateCustomer={false}
      />
    </ToastProvider>,
  );
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await flush();
}

async function createOrder() {
  fireEvent.click(screen.getByRole("button", { name: /nueva orden de servicio/i }));
  await flush(); // the vehicle picker's fetch, so the select has its option
  fireEvent.change(screen.getByLabelText(/vehículo/i), { target: { value: "v-a" } });
  fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "revisado" } });
  await save();
}

describe("ServiceOrderFormTrigger — a save that only refreshes the page is a save that says nothing", () => {
  it("announces a created order after the POST lands", async () => {
    mockApi();
    renderTrigger();

    fireEvent.click(screen.getByRole("button", { name: /nueva orden de servicio/i }));
    await flush(); // the vehicle picker's fetch, so the select has its option
    fireEvent.change(screen.getByLabelText(/vehículo/i), { target: { value: "v-a" } });
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "revisado" } });
    await save();

    expect(await screen.findByText("Orden creada")).toBeInTheDocument();
    expect(screen.queryByText("Orden actualizada")).not.toBeInTheDocument();
    // service-order-reception: a created order lands on its own detail page,
    // which is server-rendered fresh, so no refresh is needed beside it.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/service-orders/o1");
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * The `order` prop is the only thing that tells the two apart, and it is the
   * same prop `ServiceOrderForm` reads for `isEdit`. Announcing "Orden creada"
   * over an edit is worse than silence: it tells the operator a second order
   * now exists.
   */
  it("announces an updated order after the PATCH lands", async () => {
    mockApi();
    renderTrigger(EXISTING_ORDER);

    fireEvent.click(screen.getByRole("button", { name: /editar orden/i }));
    await flush();
    await save();

    expect(await screen.findByText("Orden actualizada")).toBeInTheDocument();
    expect(screen.queryByText("Orden creada")).not.toBeInTheDocument();
    // An edit stays where it is and repaints; it never navigates.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("hands the vehicle's motor to the edit form, so only the matching intake inputs show", async () => {
    mockApi();
    render(
      <ToastProvider>
        <ServiceOrderFormTrigger order={EXISTING_ORDER} canCreateCustomer={false} motor="electrico" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar orden/i }));

    expect(screen.getByLabelText(/batería/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Combustible" })).not.toBeInTheDocument();
  });

  it("does not navigate, refresh or toast when the create is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ vehicles: [VEHICLE] }) } as Response;
      }),
    );
    renderTrigger();

    await createOrder();

    expect(screen.queryByText("Orden creada")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * The ordering `OrderStatusControls` records, applied to the success path:
   * the notice goes out BEFORE `router.push()`, so a navigation that throws
   * cannot swallow the one piece of evidence that the order was saved. With
   * the two lines swapped this test is the only one here that goes red.
   *
   * The throw escapes `onSaved` — `ServiceOrderForm` calls it below its own
   * try/catch on purpose — so it surfaces as an unhandled rejection, captured
   * here rather than left for the runner (`OrderStatusControls.test.tsx`
   * records why).
   */
  it("still announces the save when the navigation that follows it throws", async () => {
    mockApi();
    const boom = new Error("refresh blew up");
    push.mockImplementationOnce(() => {
      throw boom;
    });

    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      renderTrigger();

      fireEvent.click(screen.getByRole("button", { name: /nueva orden de servicio/i }));
      await flush();
      fireEvent.change(screen.getByLabelText(/vehículo/i), { target: { value: "v-a" } });
      fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "revisado" } });
      await save();

      expect(await screen.findByText("Orden creada")).toBeInTheDocument();
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }
  });
});
