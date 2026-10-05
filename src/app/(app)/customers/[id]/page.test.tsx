/**
 * C4 verify gap: "click a vehicle card → navigate to its detail" had no runtime
 * coverage. Task 3.3 turned both card variants into links, and design D6 says
 * active and deactivated are told apart by WEIGHT rather than a caption — so
 * the deactivated one has to stay reachable, not just styled differently.
 */
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";

/**
 * `CustomerActivationButton` confirms a deactivation through `useToast()`, and
 * the provider is mounted once in `app/layout.tsx` — which a page test never
 * reaches, because it invokes the page as a plain function.
 */
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
// `useRouter` too: `CustomerActivationButton` (R20) is a client component
// rendered by this page and calls it on mount.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh }) }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "tecnico" })) }));
const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
vi.mock("@/modules/auth/policy", () => ({ can }));
// Records the props the server hands across the RSC boundary: what is passed
// here is what lands in the browser's payload.
const triggerProps = vi.hoisted(() => vi.fn());
vi.mock("@/modules/customers/CustomerFormTrigger", () => ({
  CustomerFormTrigger: (props: { triggerLabel?: React.ReactNode }) => {
    triggerProps(props);
    return <button>{props.triggerLabel}</button>;
  },
}));

const getClienteById = vi.hoisted(() => vi.fn());
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));

import CustomerDetailPage from "./page";

function vehiculo(id: string, plate: string, deactivatedAt: Date | null) {
  return {
    id, clienteId: "c1", plate, make: "Toyota", model: "Corolla", year: 2020,
    chasis: null, colorPrimario: null, colorSecundario: null, estilo: null, motor: null, numeroUnidad: null,
    placaRenovacionMes: null, seguroVence: null,
    deactivatedAt, createdAt: new Date("2026-01-01"),
  };
}

function renderPage() {
  return CustomerDetailPage({ params: Promise.resolve({ id: "c1" }) });
}

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    can.mockReturnValue(true);
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, createdAt: new Date("2026-01-01") },
      orders: [],
      vehicles: [vehiculo("v1", "ABC123", null), vehiculo("v2", "XYZ789", new Date("2026-02-01"))],
    });
  });

  it("links every vehicle card to its own history, deactivated ones included", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: /ABC123/ })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
    // The car is out of service; its history is not. A retired vehicle that
    // renders as a dead end is the failure this asserts against.
    expect(screen.getByRole("link", { name: /XYZ789/ })).toHaveAttribute("href", "/customers/c1/vehicles/v2");
  });
});

describe("CustomerDetailPage — Cédula / RUC", () => {
  const withDocumento = (documentoIdentidad: string | null) =>
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, documentoIdentidad, createdAt: new Date("2026-01-01") },
      orders: [],
      vehicles: [],
    });

  it("shows the value under its label when set", async () => {
    can.mockReturnValue(true);
    withDocumento("8-123-456");
    render(await renderPage());

    expect(screen.getByText("Cédula / RUC")).toBeInTheDocument();
    expect(screen.getByText("8-123-456")).toBeInTheDocument();
  });

  it("shows no row at all when null", async () => {
    can.mockReturnValue(true);
    withDocumento(null);
    render(await renderPage());

    expect(screen.getByText("Teléfono")).toBeInTheDocument();
    expect(screen.queryByText("Cédula / RUC")).not.toBeInTheDocument();
  });
});

/**
 * R20/D5 — a deactivated customer is READ-ONLY until reactivated. The failure
 * these guard against is a detail view that looks ordinary: staff edit a
 * record the workshop says it no longer has, and the server refuses with a 409
 * they were given no way to anticipate.
 */
describe("CustomerDetailPage — deactivated customer (R20)", () => {
  const DEACTIVATED = {
    cliente: {
      id: "c1",
      name: "Ana Gómez",
      phone: "50761111111",
      email: null,
      deactivatedAt: new Date("2026-09-01"),
      createdAt: new Date("2026-01-01"),
    },
    orders: [],
    vehicles: [vehiculo("v1", "ABC123", null)],
  };

  it("says the record is deactivated instead of rendering an ordinary detail", async () => {
    getClienteById.mockResolvedValue(DEACTIVATED);
    render(await renderPage());

    expect(screen.getByText(/cliente desactivado/i)).toBeInTheDocument();
  });

  it("offers reactivation and does NOT offer editing", async () => {
    getClienteById.mockResolvedValue(DEACTIVATED);
    render(await renderPage());

    expect(screen.getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("keeps the vehicles and their history reachable — deactivation destroys nothing", async () => {
    getClienteById.mockResolvedValue(DEACTIVATED);
    render(await renderPage());

    expect(screen.getByRole("link", { name: /ABC123/ })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
  });

  it("offers deactivation, not reactivation, for an ACTIVE customer", async () => {
    // Set explicitly: the outer describe's `beforeEach` does not reach this
    // block, so without this the mock still holds the deactivated customer
    // from the test above and this would assert nothing about an active one.
    getClienteById.mockResolvedValue({ ...DEACTIVATED, cliente: { ...DEACTIVATED.cliente, deactivatedAt: null } });
    render(await renderPage());

    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });
});

/**
 * Same regression class the list page pins: two of the three ways to put a
 * `Link` on the shared button vocabulary quietly stop it being a link —
 * `Button render={<Link/>}` with `nativeButton={false}` emits
 * `<a role="button">`, and a plain `<Button onClick>` emits a button with no
 * href. Either loses middle-click, open-in-new-tab and the link announcement.
 * The list had this test; this screen had the same change and none.
 */
describe("CustomerDetailPage — the order row action stays a link", () => {
  it("renders Ver as a link, not a button", async () => {
    // The default fixture has no orders, so the row this guards never renders.
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, createdAt: new Date("2026-01-01") },
      orders: [
        {
          id: "o1",
          status: "open",
          description: "Cambio de aceite",
          appointmentAt: new Date("2026-03-01"),
          createdAt: new Date("2026-02-01"),
        },
      ],
      vehicles: [],
    });

    render(await renderPage());

    // `getByRole`, matching the twin this mirrors: the fixture seeds exactly
    // one order, so it also fails if a second "Ver" appears. `queryAllByRole`
    // with a length check was weaker than the test it claims to copy.
    const ver = screen.getByRole("link", { name: "Ver" });
    // The href too: a link that goes nowhere is the same regression wearing
    // the right role.
    expect(ver).toHaveAttribute("href", "/service-orders/o1");
    expect(screen.queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
  });
});

/**
 * R21 — the activation button is gated on `customers.write`, the same gate
 * `CustomerSyncPanel` gets on the customer list. A button that always
 * 403s is a worse answer than no button (`CustomerForm`'s own
 * `canDeleteVehicle` docstring states this convention); both roles happen to
 * hold `customers.write` today, so this is the only place the gate is
 * actually exercised.
 */
describe("CustomerDetailPage — activation button permission gate (R21)", () => {
  beforeEach(() => {
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, createdAt: new Date("2026-01-01") },
      orders: [],
      vehicles: [],
    });
  });

  it("shows the activation button for a user with customers.write", async () => {
    can.mockReturnValue(true);
    render(await renderPage());

    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("hides the activation button for a user without customers.write", async () => {
    can.mockImplementation((_user, action) => action !== "customers.write");
    render(await renderPage());

    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
  });
});

/**
 * AGENTS.md: "Tests assert the Spanish string. Those are what catch an
 * untranslated screen." Same wording as every other gated page.
 */
describe("CustomerDetailPage — read gate", () => {
  it("refuses a session without customers.read in Spanish", async () => {
    can.mockReturnValueOnce(false);

    render(await renderPage());

    expect(screen.getByText("No tenés permiso para ver esta página.")).toBeInTheDocument();
  });
});

/**
 * `CustomerFormTrigger` is a client component: whatever this page passes it is
 * serialized into the RSC payload a technician's browser receives. The full row
 * would carry the two internal columns there even though the form never shows
 * them, so the page has to hand a viewer without `vencimientos.read` the public
 * shape. The sentinels are values no legitimate field would hold.
 */
describe("CustomerDetailPage — internal vehicle fields and the RSC payload", () => {
  const POISONED = { ...vehiculo("v1", "ABC123", null), placaRenovacionMes: 7, seguroVence: "2031-12-24" };

  beforeEach(() => {
    triggerProps.mockClear();
    getClienteById.mockResolvedValue({
      cliente: { id: "c1", name: "Ana Gómez", phone: "50761111111", email: null, createdAt: new Date("2026-01-01") },
      orders: [],
      vehicles: [POISONED],
    });
  });

  it("hands a viewer without vencimientos.read rows that carry neither internal field", async () => {
    can.mockImplementation((_user, action) => action !== "vencimientos.read");
    render(await renderPage());

    const props = triggerProps.mock.calls[0][0];
    expect(props.canEditInternal).toBe(false);
    expect(props.vehicles).toHaveLength(1);
    expect(props.vehicles[0]).not.toHaveProperty("placaRenovacionMes");
    expect(props.vehicles[0]).not.toHaveProperty("seguroVence");
    expect(JSON.stringify(props)).not.toContain("2031-12-24");
    // The public columns still arrive: the form round-trips them.
    expect(props.vehicles[0]).toMatchObject({ id: "v1", plate: "ABC123", make: "Toyota" });
  });

  it("hands a viewer WITH vencimientos.read the full rows and canEditInternal", async () => {
    can.mockReturnValue(true);
    render(await renderPage());

    const props = triggerProps.mock.calls[0][0];
    expect(props.canEditInternal).toBe(true);
    expect(props.vehicles[0]).toMatchObject({ placaRenovacionMes: 7, seguroVence: "2031-12-24" });
  });
});
