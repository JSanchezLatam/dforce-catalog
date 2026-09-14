/**
 * C4 verify gap: the three order-detail rendering scenarios had no runtime
 * coverage. Same technique as the vehicle page — await the server component,
 * hand the element to RTL, mock only the request-scoped and data edges.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/modules/service-orders/OrderStatusControls", () => ({ OrderStatusControls: () => null }));

const getOrdenServicioById = vi.hoisted(() => vi.fn());
const getClienteById = vi.hoisted(() => vi.fn());
const listRemindersForOrder = vi.hoisted(() => vi.fn<() => Promise<Reminder[]>>(async () => []));
vi.mock("@/modules/service-orders/queries", () => ({ getOrdenServicioById }));
vi.mock("@/modules/customers/queries", () => ({ getClienteById }));
vi.mock("@/modules/reminders/queries", () => ({ listRemindersForOrder }));

import type { Role } from "@/modules/auth/roles";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { OrdenServicio, Reminder } from "@/shared/db/schema";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import ServiceOrderDetailPage from "./page";

// Every `orden_servicio` column (schema.ts:412-438) — `updatedAt` was the one
// missing, and D11 hands this row to a real `ServiceOrderForm` in edit mode,
// where a fixture shaped more conveniently than the wire tests the fixture.
const ORDEN: OrdenServicio = {
  id: "o1", clienteId: "c1", vehiculoId: "v1", status: "open", categoria: "revisado",
  description: null, appointmentAt: null, completedAt: null,
  hallazgos: null, recomendaciones: null, observaciones: null,
  createdAt: new Date("2026-05-01T14:00:00Z"), updatedAt: new Date("2026-05-01T14:00:00Z"),
  createdBy: null,
};

function detailWith(deactivatedAt: Date | null) {
  return {
    cliente: { id: "c1", name: "Ana Gómez" },
    orders: [],
    vehicles: [{ id: "v1", clienteId: "c1", plate: "ABC123", make: "Toyota", model: "Corolla", year: 2020, deactivatedAt, createdAt: new Date("2026-01-01") }],
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
  });

  /**
   * service-orders spec Scenario "Detail page still shows the full id" —
   * the list truncates to 8 characters (task 2.19), this page must not.
   */
  it("shows the full, untruncated id, unlike the list's 8-character truncation", async () => {
    const fullId = "87cceecc-1111-2222-3333-444455556666";
    getOrdenServicioById.mockResolvedValue({ orden: { ...ORDEN, id: fullId }, items: [] });

    render(await ServiceOrderDetailPage({ params: Promise.resolve({ id: fullId }) }));

    expect(screen.getAllByText(fullId).length).toBeGreaterThan(0);
  });

  it("shows the vehicle as a link to its history, and the category in Spanish", async () => {
    render(await renderPage());

    expect(screen.getByRole("link", { name: "ABC123" })).toHaveAttribute("href", "/customers/c1/vehicles/v1");
    // The label a technician reads, not the enum slug stored in Postgres.
    expect(screen.getByText("REVISADO")).toBeInTheDocument();
    expect(screen.queryByText("revisado")).not.toBeInTheDocument();
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
    ["tecnico", "in_progress"],
  ])("offers the edit control to a %s on a %s order", async (role, status) => {
    render(await renderAs(role, status));

    expect(screen.getByRole("button", { name: EDIT_LABEL })).toBeInTheDocument();
  });

  it.each<[Role, OrderStatus]>([
    ["tecnico", "open"],
    ["administrador", "done"],
    ["tecnico", "done"],
    ["administrador", "cancelled"],
    ["tecnico", "cancelled"],
  ])("offers NO edit control to a %s on a %s order", async (role, status) => {
    render(await renderAs(role, status));

    expect(screen.queryByRole("button", { name: EDIT_LABEL })).not.toBeInTheDocument();
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

    const wrapper = container.querySelector("[class*='min-h-11']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("[&>button]:min-h-11");
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

  // A closed order still prints — the sheet is a record, not an action, and the
  // edit gate above refuses `done` for both roles. Rendering both assertions
  // off the SAME render is what says the two controls are independent.
  it("offers Imprimir even where the edit control is refused", async () => {
    render(await renderAs("tecnico", "done"));

    expect(screen.getByRole("link", { name: "Imprimir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT_LABEL })).not.toBeInTheDocument();
  });
});
