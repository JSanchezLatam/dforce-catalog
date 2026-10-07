/**
 * C4 verify gap: the three order-detail rendering scenarios had no runtime
 * coverage. Same technique as the vehicle page — await the server component,
 * hand the element to RTL, mock only the request-scoped and data edges.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
// `useRouter` is here for `ServiceOrderFormTrigger`, which this file mounts for
// real (see the D11 describe below) — the trigger calls it to `router.refresh()`
// after a save, and an undefined hook is a TypeError at render, not a skip.
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const requireSessionFromHeaders = vi.hoisted(() =>
  vi.fn(async () => ({ id: "u1", role: "tecnico" as Role })),
);
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders }));
vi.mock("@/modules/auth/policy", () => ({ can: vi.fn(() => true) }));
const SCOPE = vi.hoisted(() => ({ where: "scope-sentinel" }));
const orderScope = vi.hoisted(() => vi.fn<(user: unknown) => typeof SCOPE>(() => SCOPE));
vi.mock("@/modules/service-orders/scope", () => ({ orderScope }));
const statusControls = vi.hoisted(() => vi.fn<(props: { orderId: string; status: string; canAssign: boolean }) => null>(() => null));
vi.mock("@/modules/service-orders/OrderStatusControls", () => ({ OrderStatusControls: statusControls }));
const listOrderAssignees = vi.hoisted(() => vi.fn<(ordenId: string) => Promise<OrderAssignee[]>>(async () => []));
const listOrderLines = vi.hoisted(() => vi.fn<(ordenId: string) => Promise<OrderWorkLine[]>>(async () => []));
vi.mock("@/modules/service-orders/order-team", () => ({ listOrderAssignees, listOrderLines }));
const listTecnicos = vi.hoisted(() => vi.fn(async () => [] as { id: string; nombre: string; userId: null; deactivatedAt: null; createdAt: Date }[]));
const findTecnicoByUserId = vi.hoisted(() => vi.fn<(userId: string) => Promise<{ id: string } | null>>(async () => null));
vi.mock("@/modules/technicians/queries", () => ({ listTecnicos, findTecnicoByUserId }));
const workCard = vi.hoisted(() => vi.fn<(props: Record<string, unknown>) => null>(() => null));
vi.mock("@/modules/service-orders/OrderWorkCard", () => ({ OrderWorkCard: workCard }));

const getOrdenServicioById = vi.hoisted(() => vi.fn());
const getClienteById = vi.hoisted(() => vi.fn());
const listRemindersForOrder = vi.hoisted(() => vi.fn<() => Promise<Reminder[]>>(async () => []));
vi.mock("@/modules/service-orders/queries", () => ({ getOrdenServicioById }));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));
vi.mock("@/modules/reminders/queries", () => ({ listRemindersForOrder }));
// `photos.ts` imports the database and R2; the card itself (OrderPhotos) is rendered for real.
const listOrderPhotos = vi.hoisted(() => vi.fn<(ordenId: string) => Promise<{ id: string }[]>>(async () => []));
vi.mock("@/modules/service-orders/photos", () => ({ listOrderPhotos }));

import { can } from "@/modules/auth/policy";
import type { Role } from "@/modules/auth/roles";
import type { OrderAssignee, OrderWorkLine } from "@/modules/service-orders/order-team";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { OrdenServicio, Reminder, Vehiculo } from "@/shared/db/schema";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import ServiceOrderDetailPage from "./page";

// Every `orden_servicio` column (schema.ts:412-438) — `updatedAt` was the one
// missing, and D11 hands this row to a real `ServiceOrderForm` in edit mode,
// where a fixture shaped more conveniently than the wire tests the fixture.
const ORDEN: OrdenServicio = {
  id: "o1", clienteId: "c1", vehiculoId: "v1", status: "open", categoria: "revisado",
  description: null, appointmentAt: null, completedAt: null,
  hallazgos: null, recomendaciones: null, observaciones: null,
  kilometraje: null, nivelCombustible: null, bateriaPct: null,
  createdAt: new Date("2026-05-01T14:00:00Z"), updatedAt: new Date("2026-05-01T14:00:00Z"),
  createdBy: null,
};

// Every `vehiculo` column (the `vehiculo` table in schema.ts): the wire shape
// `getClienteById` returns, internal columns included, so a poisoned override
// below is something the real query could actually hand this page.
const VEHICULO: Vehiculo = {
  id: "v1", clienteId: "c1", plate: "ABC123", make: "Toyota", model: "Corolla", year: 2020,
  chasis: null, colorPrimario: null, colorSecundario: null, estilo: null, motor: null,
  numeroUnidad: null, placaRenovacionMes: null, placaMunicipio: null, seguroVence: null,
  deactivatedAt: null, createdAt: new Date("2026-01-01"),
};

function detailWith(deactivatedAt: Date | null, vehicle: Partial<Vehiculo> = {}) {
  return {
    cliente: { id: "c1", name: "Ana Gómez" },
    orders: [],
    vehicles: [{ ...VEHICULO, ...vehicle, deactivatedAt }],
  };
}

/**
 * Wrapped in the `ToastProvider` the app layout mounts around every page: the
 * D11 block below mounts the real `ServiceOrderFormTrigger`, which now
 * confirms a save with a toast, so without it `useToast()` throws at render.
 */
async function renderPage() {
  return <ToastProvider>{await ServiceOrderDetailPage({ params: Promise.resolve({ id: "o1" }) })}</ToastProvider>;
}

describe("ServiceOrderDetailPage", () => {
  beforeEach(() => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
    listOrderPhotos.mockResolvedValue([]);
  });

  /**
   * Audit #15 supersedes the main spec's "Detail page still shows the full id"
   * (service-orders spec, to be corrected at archive): the 36-character uuid
   * broke the title and the breadcrumb across lines on a phone. Both now show
   * the list's 8-character form; the full id stays one hover (or long-press)
   * away in a `title`, so nothing is lost for someone who needs to quote it.
   */
  it("shows the 8-character id in the title and the breadcrumb, never the full uuid as text", async () => {
    const fullId = "87cceecc-1111-2222-3333-444455556666";
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, id: fullId }, items: [] });

    render(<ToastProvider>{await ServiceOrderDetailPage({ params: Promise.resolve({ id: fullId }) })}</ToastProvider>);

    expect(screen.getByText("Orden 87cceecc")).toBeInTheDocument();
    expect(screen.getByText("87cceecc", { selector: '[data-slot="breadcrumb-page"]' })).toBeInTheDocument();
    expect(screen.queryByText(fullId)).not.toBeInTheDocument();
    expect(screen.queryByText(`Orden ${fullId}`)).not.toBeInTheDocument();
  });

  it("keeps the full id available as the title of both short ids", async () => {
    const fullId = "87cceecc-1111-2222-3333-444455556666";
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, id: fullId }, items: [] });

    render(<ToastProvider>{await ServiceOrderDetailPage({ params: Promise.resolve({ id: fullId }) })}</ToastProvider>);

    expect(screen.getByText("Orden 87cceecc")).toHaveAttribute("title", fullId);
    expect(screen.getByText("87cceecc", { selector: '[data-slot="breadcrumb-page"]' })).toHaveAttribute("title", fullId);
  });

  it("shows the vehicle as a link to its history, and the category in Spanish", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: "ABC123" })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
    // The label a technician reads, not the enum slug stored in Postgres.
    expect(screen.getByText("REVISADO")).toBeInTheDocument();
    expect(screen.queryByText("revisado")).not.toBeInTheDocument();
  });

  // customer-portal WU5b — these three fields reach the customer's portal page.
  it("marks Descripción, Hallazgos and Recomendaciones as visible to the customer, and never Observaciones", async () => {
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, description: "Instalar parlantes" }, items: [] });
    render(await renderPage());

    const hinted = (label: string) => screen.getByText(label).closest("dt")?.textContent?.includes("Visible para el cliente");
    expect(hinted("Descripción")).toBe(true);
    expect(hinted("Hallazgos")).toBe(true);
    expect(hinted("Recomendaciones")).toBe(true);
    expect(hinted("Observaciones")).toBe(false);
    expect(screen.getAllByText("Visible para el cliente")).toHaveLength(3);
  });

  it("renders an unset note as a placeholder row, never as a missing one", async () => {
    render(await renderPage());

    // `field()` bails on "" as well as null, which is why the page passes
    // `|| "—"` and not `??` — the row has to exist so the reader can tell
    // "nothing recorded" from "this order has no such field".
    expect(screen.getByText("Hallazgos")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  /**
   * D7 — `ordenServicioItem` lost its only writer when Piezas came out of the
   * intake dialog, so every order created from now on has zero line items and
   * this card renders its empty state permanently. The card and the table
   * stay for the rows that already exist and for a later record-what-was-used
   * flow, which is why this pins the empty state rather than the card's
   * removal.
   */
  it("renders the Piezas utilizadas card in its empty state for an order created after D7", async () => {
    render(await renderPage());

    expect(screen.getByText("Piezas utilizadas")).toBeInTheDocument();
    expect(screen.getByText("Esta orden no tiene piezas registradas.")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Pieza" })).not.toBeInTheDocument();
  });

  /**
   * The label the owner asked for by name, on the page staff actually reads.
   * It shipped with no assertion anywhere but the form, and AGENTS.md is
   * explicit: "Tests assert the Spanish string. Those are what catch an
   * untranslated screen."
   *
   * The negative half is scoped to the `<dt>` terms ON PURPOSE, and the
   * fixture seeds an `appointment` reminder so that "Cita" IS on the page:
   * `REMINDER_TYPE_LABEL.appointment` renders it in the Recordatorios table,
   * and the narrow list-column header on `/service-orders` keeps the short
   * form deliberately. A document-wide `queryByText("Cita")` would therefore
   * pass only for as long as nobody seeds a reminder — a green assertion
   * resting on an empty mock, not on the label under test.
   */
  it("labels the start time 'Fecha y hora de inicio', not 'Cita'", async () => {
    getOrdenServicioById.mockResolvedValue({
      orden: { ...ORDEN, appointmentAt: new Date("2026-06-02T15:30:00Z") },
      items: [],
    });
    // Every column, not the four this assertion reads: AGENTS.md — "a mock
    // more convenient than reality tests the mock, not the code."
    listRemindersForOrder.mockResolvedValue([
      {
        id: "r1", ordenId: "o1", clienteId: "c1",
        type: "appointment", channel: "whatsapp", status: "scheduled",
        scheduledFor: new Date("2026-06-01T15:30:00Z"), sentAt: null,
        jobId: null, error: null, createdAt: new Date("2026-05-01T14:00:00Z"),
      },
    ]);

    render(await renderPage());

    const terms = screen.getAllByRole("term").map((dt) => dt.textContent);
    expect(terms).toContain("Fecha y hora de inicio");
    expect(terms).not.toContain("Cita");
    // The reminder's own "Cita" is still on the page — that is the point.
    expect(screen.getByRole("cell", { name: "Cita" })).toBeInTheDocument();
  });

  it("still shows the vehicle's identity and link when that vehicle is DEACTIVATED", async () => {
    getClienteById.mockResolvedValue(detailWith(new Date("2026-02-01")));

    render(await renderPage());

    // The car left the customer; its service history did not. This only works
    // because getClienteById reads with includeInactive: true.
    expect(screen.getByRole("link", { name: "ABC123" })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
  });
});

/**
 * D11 — the edit entry point, gated server-side by `canEditOrderFields`. Only
 * a boolean is evaluated on the server; `ServiceOrderFormTrigger` is a
 * `"use client"` component receiving the order as plain data, so no function
 * crosses the RSC boundary.
 *
 * `ServiceOrderFormTrigger` is deliberately NOT mocked here: a stub rendering
 * the label would assert the stub, not that the real trigger mounts and
 * carries the Spanish label `ServiceOrderForm` gives it in edit mode.
 *
 * AGENTS.md, verbatim: jsdom invokes a page as a plain function, so it cannot
 * see an RSC serialization refusal or a hydration mismatch. These cases prove
 * the gate decides correctly; they are NOT evidence that the control mounts in
 * a browser. Task 4.12 is.
 */
describe("ServiceOrderDetailPage — vehicle descriptive fields", () => {
  beforeEach(() => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "administrador" });
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    listRemindersForOrder.mockResolvedValue([]);
  });

  /** The `<dd>` beside a `<dt>`; fails by name when the label is absent. */
  function valueFor(label: string): string {
    const term = screen.getAllByRole("term").find((dt) => dt.textContent === label);
    expect(term, `no <dt> labelled "${label}"`).toBeDefined();
    return term!.nextElementSibling!.textContent!;
  }

  it("shows chasis, both colors on one line, estilo, motor in Spanish and the unit number when set", async () => {
    getClienteById.mockResolvedValue(
      detailWith(null, {
        chasis: "3N6AD33A0LK812345", colorPrimario: "Gris", colorSecundario: "Negro",
        estilo: "Pick-up", motor: "hibrido", numeroUnidad: "U-12",
      }),
    );

    render(await renderPage());

    expect(valueFor("Chasis")).toBe("3N6AD33A0LK812345");
    expect(valueFor("Color")).toBe("Gris / Negro");
    expect(valueFor("Estilo")).toBe("Pick-up");
    expect(valueFor("Motor")).toBe("Híbrido");
    expect(valueFor("Nº de unidad")).toBe("U-12");
  });

  it("shows only the primary color when there is no secondary, and omits the unit label when empty", async () => {
    getClienteById.mockResolvedValue(detailWith(null, { colorPrimario: "Rojo", motor: "combustion" }));

    render(await renderPage());

    expect(valueFor("Color")).toBe("Rojo");
    expect(valueFor("Motor")).toBe("Combustión");
    expect(screen.queryByText("Nº de unidad")).not.toBeInTheDocument();
  });

  it("renders a placeholder, never a blank row, for an unset descriptive field", async () => {
    getClienteById.mockResolvedValue(detailWith(null));

    render(await renderPage());

    for (const label of ["Chasis", "Color", "Estilo", "Motor"]) {
      expect(valueFor(label), label).toBe("—");
    }
  });

  it("never renders the plate renewal month or the insurance expiry, even when the row carries them", async () => {
    getClienteById.mockResolvedValue(
      detailWith(null, { chasis: "CH1", placaRenovacionMes: 11, placaMunicipio: "SENTINEL-MUNICIPIO", seguroVence: "2031-12-24" }),
    );

    const { container } = render(await renderPage());

    const text = container.textContent!;
    expect(text).not.toContain("2031-12-24");
    expect(text).not.toContain("SENTINEL-MUNICIPIO");
    expect(text).not.toContain("24/12/2031");
    expect(text).not.toContain("noviembre");
    expect(screen.getAllByRole("definition").map((dd) => dd.textContent)).not.toContain("11");
    // The poisoned row still rendered its allowed fields: the absence above
    // comes from the allowlist, not from the row never reaching the page.
    expect(valueFor("Chasis")).toBe("CH1");
  });
});

describe("ServiceOrderDetailPage — the edit control (D11)", () => {
  beforeEach(() => {
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
  });

  function renderAs(role: Role, status: OrderStatus) {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role });
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, status }, items: [] });
    return renderPage();
  }

  const EDIT_LABEL = "Editar orden";

  it.each<[Role, OrderStatus]>([
    ["administrador", "open"],
    ["administrador", "in_progress"],
    ["administrador", "ready_for_review"],
    ["jefe_taller", "ready_for_review"],
    ["tecnico", "in_progress"],
  ])("offers the edit control to a %s on a %s order", async (role, status) => {
    render(await renderAs(role, status));

    expect(screen.getByRole("button", { name: EDIT_LABEL })).toBeInTheDocument();
  });

  it.each<[Role, OrderStatus]>([
    ["tecnico", "open"],
    ["tecnico", "ready_for_review"],
    ["administrador", "done"],
    ["tecnico", "done"],
    ["administrador", "cancelled"],
    ["tecnico", "cancelled"],
  ])("offers NO edit control to a %s on a %s order", async (role, status) => {
    render(await renderAs(role, status));

    expect(screen.queryByRole("button", { name: EDIT_LABEL })).not.toBeInTheDocument();
  });

  /**
   * closed-order-lock WU4: a closed order is not plainly editable, but an
   * administrador may correct it. The same mount carries the 44x44 floor.
   */
  const CORRECT_LABEL = "Corregir";

  it.each<OrderStatus>(["done", "cancelled"])("offers Corregir, and no plain edit control, to an administrador on a %s order", async (status) => {
    render(await renderAs("administrador", status));

    expect(screen.getByRole("button", { name: CORRECT_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT_LABEL })).not.toBeInTheDocument();
  });

  it.each<[Role, OrderStatus]>([
    ["tecnico", "done"],
    ["tecnico", "cancelled"],
    ["tecnico", "open"],
    ["tecnico", "in_progress"],
    ["administrador", "open"],
    ["administrador", "in_progress"],
  ])("never offers Corregir to a %s on a %s order", async (role, status) => {
    render(await renderAs(role, status));

    expect(screen.queryByRole("button", { name: CORRECT_LABEL })).not.toBeInTheDocument();
  });

  it("opens Corregir on a form that asks for the password", async () => {
    render(await renderAs("administrador", "done"));
    fireEvent.click(screen.getByRole("button", { name: CORRECT_LABEL }));

    expect(screen.getByRole("dialog", { name: "Corregir orden de servicio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña")).toHaveAttribute("type", "password");
  });

  it("applies the 44x44 floor to Corregir from its mount", async () => {
    const { container } = render(await renderAs("administrador", "done"));

    const wrapper = Array.from(container.querySelectorAll("div")).find((el) =>
      el.className.includes("[&>button]:min-h-11"),
    );
    expect(wrapper).toBeDefined();
    expect(wrapper!.className).toContain("[&>button]:min-w-11");
    expect(wrapper!.firstElementChild).toBe(screen.getByRole("button", { name: CORRECT_LABEL }));
  });

  /**
   * AGENTS.md's 44x44 floor. `ServiceOrderForm` renders its edit trigger as
   * `<Button variant="outline" size="sm">` — `h-7`, 28px — and exposes no
   * `className` for the mount to pass, so the floor is applied from here with
   * a child selector on the wrapper. That is why the assertion reads the
   * wrapper's classes and its button child, not the button's own `className`:
   * no test in this repo can measure a rendered height (jsdom has no
   * Tailwind), so this pins the rule's mechanism, and the browser check
   * measures it.
   */
  it("applies the 44x44 floor to the edit control from its mount", async () => {
    const { container } = render(await renderAs("administrador", "open"));

    // The wrapper's own utility, not any `min-h-11`: the breadcrumb link
    // carries a `pointer-coarse:min-h-11` of its own and comes first in the DOM.
    const wrapper = Array.from(container.querySelectorAll("div")).find((el) =>
      el.className.includes("[&>button]:min-h-11"),
    );
    expect(wrapper).toBeDefined();
    expect(wrapper!.className).toContain("[&>button]:min-w-11");
    expect(wrapper!.firstElementChild).toBe(screen.getByRole("button", { name: EDIT_LABEL }));
  });

  /**
   * WU3 (D8) — the spec Scenario "Imprimir navigates to the print view" had no
   * assertion anywhere: the link shipped in the print unit, whose scope did not
   * include this file. Pinned here because this is where the control lives.
   *
   * It is a `<Link>` styled with `buttonVariants`, deliberately NOT
   * `<Button render={<Link/>}>` — the reason is recorded at
   * `customers/[id]/page.tsx:235`. So `getByRole("link")` is the assertion that
   * would catch someone converting it into a client-component button and
   * putting the first `"use client"` import onto this page.
   *
   * The class assertion is the same mechanism-not-measurement compromise as the
   * edit control above: jsdom has no Tailwind, so nothing here proves 44 real
   * pixels. Task 3.12's print preview measures it.
   */
  it("offers Imprimir as a plain link to the print view, at the 44x44 floor", async () => {
    render(await renderAs("tecnico", "done"));

    const link = screen.getByRole("link", { name: "Imprimir" });
    expect(link).toHaveAttribute("href", "/service-orders/o1/print");
    expect(link.className).toContain("min-h-11");
    expect(link.className).toContain("min-w-11");
  });

  /**
   * Owner report from a 390px phone: the header row never wrapped, so the
   * action buttons were pushed past the right edge and clipped, and a long
   * label ("Recomendaciones") overlapped its value in the 1/3 label column.
   * jsdom has no Tailwind, so this pins the mechanism (the action row may wrap,
   * a field row stacks below `sm`); the LAN browser check measures the pixels.
   */
  it("lets the header actions wrap and stacks field rows below sm", async () => {
    render(await renderAs("administrador", "open"));

    const actions = screen.getByRole("link", { name: "Imprimir" }).parentElement!;
    expect(actions.className).toContain("flex-wrap");

    const row = screen.getByText("Recomendaciones").parentElement!;
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("sm:grid-cols-3");
  });

  // A closed order still prints — the sheet is a record, not an action, and the
  // edit gate above refuses `done` for both roles. Rendering both assertions
  // off the SAME render is what says the two controls are independent.
  it("offers Imprimir even where the edit control is refused", async () => {
    render(await renderAs("tecnico", "done"));

    expect(screen.getByRole("link", { name: "Imprimir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT_LABEL })).not.toBeInTheDocument();
  });
});

/**
 * service-order-reception — the "Recepción" card. The intake is optional, so
 * an unset kilometraje reads as a warning chip rather than a silent blank: the
 * technician must be able to tell "nobody recorded it" from "there is no such
 * field".
 */
describe("ServiceOrderDetailPage — Recepción card", () => {
  function renderWith(intake: Partial<OrdenServicio>, motor: Vehiculo["motor"] = null) {
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, ...intake }, items: [] });
    getClienteById.mockResolvedValue(detailWith(null, { motor }));
    return renderPage();
  }

  /** The `<dd>` next to a `<dt>` term inside the Recepción card. */
  function valueOf(term: string): HTMLElement {
    const card = screen.getByText("Recepción").closest("[data-slot='card']") as HTMLElement;
    const dt = within(card).getByText(term, { selector: "dt" });
    return dt.nextElementSibling as HTMLElement;
  }

  it("shows the kilometraje with a thousands separator and the unit", async () => {
    render(await renderWith({ kilometraje: 85000 }));

    expect(valueOf("Kilometraje")).toHaveTextContent("85.000 km");
  });

  it("shows 'Sin kilometraje' when it is null, and a 0 as a real reading", async () => {
    const { unmount } = render(await renderWith({ kilometraje: null }));
    expect(valueOf("Kilometraje")).toHaveTextContent("Sin kilometraje");
    unmount();

    render(await renderWith({ kilometraje: 0 }));
    expect(valueOf("Kilometraje")).toHaveTextContent("0 km");
    expect(screen.queryByText("Sin kilometraje")).not.toBeInTheDocument();
  });

  it.each([
    [0, "Vacío"],
    [1, "1/4"],
    [2, "1/2"],
    [3, "3/4"],
    [4, "Lleno"],
  ])("shows fuel level %i as %s", async (level, label) => {
    render(await renderWith({ nivelCombustible: level }, "combustion"));

    expect(valueOf("Combustible")).toHaveTextContent(new RegExp(`^${label}$`));
  });

  it("shows the battery percentage and the fuel level together", async () => {
    render(await renderWith({ bateriaPct: 80, nivelCombustible: 3 }, "hibrido"));

    expect(valueOf("Batería")).toHaveTextContent("80%");
    expect(valueOf("Combustible")).toHaveTextContent("3/4");
  });

  it("shows 0% as a real reading, not as a missing one", async () => {
    render(await renderWith({ bateriaPct: 0 }, "electrico"));

    expect(valueOf("Batería")).toHaveTextContent("0%");
  });

  it.each([
    ["combustion", "Combustible", "Batería"],
    ["electrico", "Batería", "Combustible"],
  ] as const)("a %s vehicle with nothing recorded shows %s as '—' and no %s row", async (motor, shown, hidden) => {
    render(await renderWith({}, motor));

    expect(valueOf(shown)).toHaveTextContent("—");
    const card = screen.getByText("Recepción").closest("[data-slot='card']") as HTMLElement;
    expect(within(card).queryByText(hidden, { selector: "dt" })).not.toBeInTheDocument();
  });

  it("still shows a recorded value the motor says is not applicable", async () => {
    render(await renderWith({ bateriaPct: 55 }, "combustion"));

    expect(valueOf("Batería")).toHaveTextContent("55%");
  });

  it("still shows a recorded fuel level on an electric vehicle", async () => {
    render(await renderWith({ nivelCombustible: 3 }, "electrico"));

    expect(valueOf("Combustible")).toHaveTextContent("3/4");
  });

  it("hands the vehicle's motor to the edit form", async () => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "administrador" });
    render(await renderWith({}, "electrico"));

    fireEvent.click(screen.getByRole("button", { name: "Editar orden" }));

    expect(screen.getByLabelText(/batería/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Combustible" })).not.toBeInTheDocument();
  });
});

/**
 * AGENTS.md: "Tests assert the Spanish string. Those are what catch an
 * untranslated screen." Same wording as every other gated page.
 */
describe("ServiceOrderDetailPage — read gate", () => {
  it("refuses a session without service-orders.read in Spanish", async () => {
    vi.mocked(can).mockReturnValueOnce(false);

    render(await renderPage());

    expect(screen.getByRole("heading", { level: 1, name: "Orden de servicio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "No tenés permiso para ver esta página" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});

/**
 * Reception photos card. Both booleans are resolved HERE, on the server, from
 * the same predicates the routes enforce: `canChangeOrderPhotos` (status) plus
 * `service-orders.write` / `service-orders.deletePhoto` (role).
 */
describe("ServiceOrderDetailPage — reception photos card", () => {
  const roleCan = (allowed: string[]) =>
    vi.mocked(can).mockImplementation(((_user: unknown, action: string) => allowed.includes(action)) as typeof can);
  // The main describe's beforeEach is scoped to it: without this, the order status set by
  // `asOrder("cancelled")` below leaked into every later test and made them pass trivially.
  beforeEach(() => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
    listOrderPhotos.mockResolvedValue([]);
  });
  afterEach(() => vi.mocked(can).mockImplementation(() => true));

  const asOrder = (status: OrderStatus) => getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, status }, items: [] });
  const card = () => screen.getByText("Fotos de recepción").closest("[data-slot='card']") as HTMLElement;

  it("lists this order's photos, in the order the query returns them (by position)", async () => {
    listOrderPhotos.mockResolvedValue([{ id: "p9" }, { id: "p2" }, { id: "p5" }]);

    render(await renderPage());

    expect(listOrderPhotos).toHaveBeenCalledWith("o1", SCOPE);
    expect(within(card()).getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual([
      "/api/service-orders/o1/photos/p9",
      "/api/service-orders/o1/photos/p2",
      "/api/service-orders/o1/photos/p5",
    ]);
    expect(within(card()).getByText("3 de 12")).toBeInTheDocument();
  });

  it("lets a técnico add but not delete on an open order", async () => {
    roleCan(["service-orders.read", "service-orders.write"]);
    listOrderPhotos.mockResolvedValue([{ id: "p1" }]);

    render(await renderPage());

    expect(within(card()).getByLabelText("Agregar fotos")).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /Borrar foto/ })).not.toBeInTheDocument();
  });

  it("lets an administrador add and delete on an in_progress order", async () => {
    roleCan(["service-orders.read", "service-orders.write", "service-orders.deletePhoto"]);
    asOrder("in_progress");
    listOrderPhotos.mockResolvedValue([{ id: "p1" }]);

    render(await renderPage());

    expect(within(card()).getByLabelText("Agregar fotos")).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Borrar foto 1" })).toBeInTheDocument();
  });

  it.each(["done", "cancelled"] as const)("offers neither add nor delete on a %s order to a role that cannot correct", async (status) => {
    roleCan(["service-orders.read", "service-orders.write", "service-orders.deletePhoto"]);
    asOrder(status);
    listOrderPhotos.mockResolvedValue([{ id: "p1" }]);

    render(await renderPage());

    expect(within(card()).getAllByRole("img")).toHaveLength(1);
    expect(within(card()).queryByLabelText("Agregar fotos")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /Borrar foto/ })).not.toBeInTheDocument();
  });

  it.each(["done", "cancelled"] as const)("offers add and delete on a %s order to a role that can correct, behind the password", async (status) => {
    roleCan(["service-orders.read", "service-orders.write", "service-orders.deletePhoto", "service-orders.correct"]);
    asOrder(status);
    listOrderPhotos.mockResolvedValue([{ id: "p1" }]);

    render(await renderPage());

    expect(within(card()).getByLabelText("Agregar fotos")).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole("button", { name: "Borrar foto 1" }));
    expect(screen.getByLabelText("Tu contraseña")).toHaveAttribute("type", "password");
    expect(
      within(card()).queryByText("Las fotos no se pueden agregar ni borrar cuando la orden está terminada o cancelada."),
    ).not.toBeInTheDocument();
  });

  it("offers a técnico no add control on a ready_for_review order, and says who may", async () => {
    roleCan(["service-orders.read", "service-orders.write"]);
    asOrder("ready_for_review");

    render(await renderPage());

    expect(within(card()).queryByLabelText("Agregar fotos")).not.toBeInTheDocument();
    expect(
      within(card()).getByText("Las fotos de una orden lista para revisión las agrega el administrador o el jefe de taller."),
    ).toBeInTheDocument();
  });

  it("offers staff (service-orders.assign) the add control on a ready_for_review order", async () => {
    roleCan(["service-orders.read", "service-orders.write", "service-orders.assign"]);
    asOrder("ready_for_review");

    render(await renderPage());

    expect(within(card()).getByLabelText("Agregar fotos")).toBeInTheDocument();
    expect(within(card()).queryByText(/lista para revisión las agrega/)).not.toBeInTheDocument();
  });

  it("asks for no password to delete a photo of an order that is still open", async () => {
    roleCan(["service-orders.read", "service-orders.write", "service-orders.deletePhoto", "service-orders.correct"]);
    asOrder("in_progress");
    listOrderPhotos.mockResolvedValue([{ id: "p1" }]);

    render(await renderPage());
    fireEvent.click(within(card()).getByRole("button", { name: "Borrar foto 1" }));

    expect(screen.queryByLabelText("Tu contraseña")).not.toBeInTheDocument();
  });

  it("offers no add control to a role without service-orders.write", async () => {
    roleCan(["service-orders.read"]);

    render(await renderPage());

    expect(within(card()).queryByLabelText("Agregar fotos")).not.toBeInTheDocument();
  });

  it("explains that a finished or cancelled order's photos are frozen to a role that cannot correct", async () => {
    roleCan(["service-orders.read", "service-orders.write"]);
    asOrder("done");

    render(await renderPage());

    expect(
      within(card()).getByText("Las fotos no se pueden agregar ni borrar cuando la orden está terminada o cancelada."),
    ).toBeInTheDocument();
  });
});

describe("ServiceOrderDetailPage — the customer and vehicle links on touch (audit-final N6)", () => {
  beforeEach(() => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "tecnico" });
    getOrdenServicioById.mockResolvedValue({ orden: ORDEN, items: [] });
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
    listOrderPhotos.mockResolvedValue([]);
  });

  // They are the only path from an order to its customer and its vehicle and
  // measured 18px tall. jsdom has no Tailwind: this reads the class that
  // carries the floor, as the breadcrumb link's test does.
  it.each([
    ["Ana Gómez", "/customers/c1"],
    ["ABC123", "/customers/c1/vehicles/v1"],
  ])("%s is a 44px-tall link on a touch screen", async (name, href) => {
    render(await renderPage());

    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveClass("pointer-coarse:inline-flex", "pointer-coarse:min-h-11", "pointer-coarse:items-center");
  });
});

describe("ServiceOrderDetailPage — order scope", () => {
  it("scopes the order, its photos and the customer lookup by the session user; an unassigned order is a 404", async () => {
    getOrdenServicioById.mockClear();
    getClienteById.mockClear();
    listOrderPhotos.mockClear();
    render(<ToastProvider>{await ServiceOrderDetailPage({ params: Promise.resolve({ id: ORDEN.id }) })}</ToastProvider>);

    expect(orderScope).toHaveBeenCalledWith({ id: "u1", role: "tecnico" });
    expect(getOrdenServicioById).toHaveBeenCalledWith(ORDEN.id, SCOPE);
    expect(getClienteById.mock.calls[0][1]).toBe(SCOPE);
    expect(listOrderPhotos).toHaveBeenCalledWith(ORDEN.id, SCOPE);

    getOrdenServicioById.mockResolvedValue(null);
    await expect(ServiceOrderDetailPage({ params: Promise.resolve({ id: ORDEN.id }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("ServiceOrderDetailPage — technicians on the order", () => {
  const tecnicoRow = (id: string, nombre: string) => ({ id, nombre, userId: null, deactivatedAt: null, createdAt: new Date("2026-01-01") });
  const roleCan = (allowed: string[]) =>
    vi.mocked(can).mockImplementation(((_user: unknown, action: string) => allowed.includes(action)) as typeof can);

  beforeEach(() => {
    requireSessionFromHeaders.mockResolvedValue({ id: "u1", role: "jefe_taller" });
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, status: "in_progress" }, items: [] });
    getClienteById.mockResolvedValue(detailWith(null));
    listRemindersForOrder.mockResolvedValue([]);
    listOrderPhotos.mockResolvedValue([]);
    listOrderAssignees.mockResolvedValue([]);
    listOrderLines.mockResolvedValue([]);
    findTecnicoByUserId.mockResolvedValue(null);
    workCard.mockClear();
    listTecnicos.mockResolvedValue([]);
    listTecnicos.mockClear();
    statusControls.mockClear();
    roleCan(["service-orders.read", "service-orders.assign", "service-orders.write"]);
  });
  afterEach(() => vi.mocked(can).mockImplementation(() => true));

  const card = () => screen.getByText("Técnicos asignados").closest("[data-slot='card']") as HTMLElement;

  it("lists the assignees by name and flags a deactivated one", async () => {
    listOrderAssignees.mockResolvedValue([
      { tecnicoId: "t1", nombre: "Ana Mecánica", active: true, parteLista: false },
      { tecnicoId: "t2", nombre: "Beto Frenos", active: false, parteLista: false },
    ]);
    render(await renderPage());

    expect(within(card()).getByText("Ana Mecánica")).toBeInTheDocument();
    expect(within(card()).getByText("Beto Frenos")).toBeInTheDocument();
    expect(within(card()).getByText("Inactivo")).toBeInTheDocument();
  });

  it("says nobody is assigned yet", async () => {
    render(await renderPage());

    expect(within(card()).getByText("Esta orden todavía no tiene técnicos asignados.")).toBeInTheDocument();
  });

  it("offers staff the active roster minus the technicians already assigned", async () => {
    listOrderAssignees.mockResolvedValue([{ tecnicoId: "t1", nombre: "Ana Mecánica", active: true, parteLista: false }]);
    listTecnicos.mockResolvedValue([tecnicoRow("t1", "Ana Mecánica"), tecnicoRow("t2", "Beto Frenos")]);
    render(await renderPage());

    // `listTecnicos()` with no argument is the ACTIVE roster: a deactivated technician is never offered.
    expect(listTecnicos).toHaveBeenCalledWith();
    const options = Array.from(within(card()).getByLabelText("Asignar técnico").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Elegí un técnico", "Beto Frenos"]);
  });

  it("offers a caller without service-orders.assign no assignment control and reads no roster", async () => {
    roleCan(["service-orders.read", "service-orders.write"]);
    render(await renderPage());

    expect(screen.queryByLabelText("Asignar técnico")).not.toBeInTheDocument();
    expect(listTecnicos).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>(["done", "cancelled"])("offers no assignment control on a %s order", async (status) => {
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, status }, items: [] });
    listTecnicos.mockResolvedValue([tecnicoRow("t2", "Beto Frenos")]);
    render(await renderPage());

    expect(screen.queryByLabelText("Asignar técnico")).not.toBeInTheDocument();
    expect(listTecnicos).not.toHaveBeenCalled();
  });

  it.each([true, false])("hands the status controls canAssign=%s to match service-orders.assign", async (assign) => {
    roleCan(assign ? ["service-orders.read", "service-orders.assign"] : ["service-orders.read"]);
    render(await renderPage());

    expect(statusControls).toHaveBeenCalledWith({ orderId: "o1", status: "in_progress", canAssign: assign }, undefined);
  });

  describe("the work-lines card", () => {
    const ASSIGNEE: OrderAssignee = { tecnicoId: "t1", nombre: "Ana Mecánica", active: true, parteLista: false };
    const LINE: OrderWorkLine = {
      id: "l1", tecnicoId: "t1", tecnicoNombre: "Ana Mecánica", descripcion: "Cambio de aceite", duracionMinutos: 45, fecha: "2026-03-04",
    };
    const asRole = (role: Role, status: OrderStatus = "in_progress") => {
      requireSessionFromHeaders.mockResolvedValue({ id: "u7", role });
      getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, status }, items: [] });
    };
    const lastProps = () => workCard.mock.calls.at(-1)![0];

    it("titles the card and hands it this order's team, lines and the viewer's roster row", async () => {
      listOrderAssignees.mockResolvedValue([ASSIGNEE]);
      listOrderLines.mockResolvedValue([LINE]);
      findTecnicoByUserId.mockResolvedValue({ id: "t1" });
      asRole("tecnico");
      render(await renderPage());

      expect(screen.getByText("Líneas de trabajo")).toBeInTheDocument();
      expect(listOrderLines).toHaveBeenCalledWith("o1");
      expect(findTecnicoByUserId).toHaveBeenCalledWith("u7");
      expect(lastProps()).toEqual({
        orderId: "o1",
        status: "in_progress",
        assignees: [ASSIGNEE],
        lines: [LINE],
        mode: "write",
        viewerTecnicoId: "t1",
        canManageAll: true,
      });
    });

    it("crosses the RSC boundary as plain data: it survives a JSON round trip unchanged", async () => {
      listOrderAssignees.mockResolvedValue([ASSIGNEE]);
      listOrderLines.mockResolvedValue([LINE]);
      render(await renderPage());

      const props = lastProps();
      expect(JSON.parse(JSON.stringify(props))).toEqual(props);
      expect(Object.values(props).some((v) => typeof v === "function")).toBe(false);
    });

    it("passes viewerTecnicoId null to a login with no roster row", async () => {
      render(await renderPage());

      expect(lastProps().viewerTecnicoId).toBeNull();
    });

    it("passes canManageAll=false to a caller without service-orders.assign", async () => {
      roleCan(["service-orders.read", "service-orders.write"]);
      render(await renderPage());

      expect(lastProps().canManageAll).toBe(false);
    });

    it.each<[Role, OrderStatus, string]>([
      ["administrador", "done", "correction"],
      ["administrador", "cancelled", "correction"],
      ["jefe_taller", "done", "refused"],
      ["tecnico", "open", "refused"],
      ["tecnico", "ready_for_review", "refused"],
      ["jefe_taller", "ready_for_review", "write"],
      ["tecnico", "in_progress", "write"],
    ])("resolves mode for %s on a %s order as %s", async (role, status, mode) => {
      asRole(role, status);
      render(await renderPage());

      expect(lastProps().mode).toBe(mode);
    });
  });
});
