import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio } from "@/shared/db/schema";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { APPOINTMENT_LEAD_HOURS, planReminders, SERVICE_DUE_AFTER_DAYS } from "./schedule";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function makeOrden(overrides: Partial<OrdenServicio> = {}): OrdenServicio {
  return {
    id: "orden-1",
    clienteId: "cliente-1",
    status: "open",
    description: null,
    appointmentAt: null,
    completedAt: null,
    createdBy: null,
    // `orden_servicio.categoria` is `.notNull()`, so the fixture cannot leave
    // it out. Defaulted to a category that DOES get a `service_due` reminder,
    // so every pre-existing test keeps the behaviour it was written for unless
    // it opts into another one.
    categoria: "mant_preventivo",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as OrdenServicio;
}

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "cliente-1",
    name: "Juan Perez",
    phone: "+5491122334455",
    email: "juan@example.com",
    whatsappOptOut: false,
    emailOptOut: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Cliente;
}

describe("planReminders — R23 timing", () => {
  it("plans an appointment reminder at appointmentAt - APPOINTMENT_LEAD_HOURS, for both channels", () => {
    const appointmentAt = new Date("2026-08-01T10:00:00.000Z");
    const orden = makeOrden({ appointmentAt });
    const cliente = makeCliente();

    const plans = planReminders(orden, cliente, NOW);

    const expectedTime = new Date(appointmentAt.getTime() - APPOINTMENT_LEAD_HOURS * 60 * 60 * 1000);
    expect(plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "appointment", channel: "whatsapp", scheduledFor: expectedTime }),
        expect.objectContaining({ type: "appointment", channel: "email", scheduledFor: expectedTime }),
      ]),
    );
    expect(plans).toHaveLength(2);
  });

  it("plans a service_due reminder at completedAt + SERVICE_DUE_AFTER_DAYS", () => {
    const completedAt = new Date("2026-07-01T00:00:00.000Z");
    const orden = makeOrden({ completedAt });
    const cliente = makeCliente();

    const plans = planReminders(orden, cliente, NOW);

    const expectedTime = new Date(completedAt.getTime() + SERVICE_DUE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    expect(plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "service_due", channel: "whatsapp", scheduledFor: expectedTime }),
        expect.objectContaining({ type: "service_due", channel: "email", scheduledFor: expectedTime }),
      ]),
    );
    expect(plans).toHaveLength(2);
  });

  it("plans both types when both appointmentAt and completedAt are set on the order", () => {
    const orden = makeOrden({
      appointmentAt: new Date("2026-08-01T10:00:00.000Z"),
      completedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const plans = planReminders(orden, makeCliente(), NOW);
    expect(plans.filter((p) => p.type === "appointment")).toHaveLength(2);
    expect(plans.filter((p) => p.type === "service_due")).toHaveLength(2);
  });

  it("returns no plans when neither appointmentAt nor completedAt is set", () => {
    expect(planReminders(makeOrden(), makeCliente(), NOW)).toEqual([]);
  });

  it("skips the whatsapp channel when the cliente has no phone", () => {
    const orden = makeOrden({ appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const plans = planReminders(orden, makeCliente({ phone: "" }), NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0].channel).toBe("email");
  });

  it("skips the email channel when the cliente has no email", () => {
    const orden = makeOrden({ appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const plans = planReminders(orden, makeCliente({ email: null }), NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0].channel).toBe("whatsapp");
  });

  it("skips the whatsapp channel when whatsappOptOut is true, but still plans email (R26 — independent per channel)", () => {
    const orden = makeOrden({ appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const plans = planReminders(orden, makeCliente({ whatsappOptOut: true }), NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0].channel).toBe("email");
  });

  it("skips the email channel when emailOptOut is true, but still plans whatsapp (R26 — independent per channel)", () => {
    const orden = makeOrden({ appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const plans = planReminders(orden, makeCliente({ emailOptOut: true }), NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0].channel).toBe("whatsapp");
  });

  it("drops a computed reminder time that is already in the past relative to now (R23 — stale reminders never fire)", () => {
    // appointment yesterday minus lead hours => already past
    const orden = makeOrden({ appointmentAt: new Date("2026-07-26T11:00:00.000Z") });
    const plans = planReminders(orden, makeCliente(), NOW);
    expect(plans).toEqual([]);
  });

  it("stamps ordenId/clienteId on every planned reminder", () => {
    const orden = makeOrden({ id: "orden-42", clienteId: "cliente-42", appointmentAt: new Date("2026-08-01T10:00:00.000Z") });
    const cliente = makeCliente({ id: "cliente-42" });
    const plans = planReminders(orden, cliente, NOW);
    for (const plan of plans) {
      expect(plan.ordenId).toBe("orden-42");
      expect(plan.clienteId).toBe("cliente-42");
    }
  });
});

/**
 * The owner's rule: remind 90 days after PREVENTIVE or CORRECTIVE maintenance.
 * The 90 days already existed; the condition did not, so `service_due` fired
 * for all five categories — nobody had ever written down which ones it was
 * for, because reminder scheduling has no capability spec at all.
 *
 * Driven off `CATEGORIA_LABEL`'s own keys rather than a hand-written list, so
 * a sixth category added tomorrow fails here until somebody decides whether it
 * reminds. Inheriting that decision by default is how this defect started.
 *
 * Note what this REMOVES: `instalacion`, `reparacion` and `revisado` get a
 * reminder today and will not after this. `revisado` is Panama's mandatory
 * ANNUAL ATTT inspection, so 90 days was always the wrong interval for it —
 * 365 is what it actually wants, and that is its own change, not this gate
 * loosened.
 */
describe("planReminders — service_due is restricted by category", () => {
  const SCHEDULED = new Set(["mant_preventivo", "mant_correctivo"]);

  describe.each(Object.keys(CATEGORIA_LABEL))("%s", (categoria) => {
    it(SCHEDULED.has(categoria) ? "schedules service_due" : "schedules NO service_due", () => {
      const orden = makeOrden({
        completedAt: new Date(NOW.getTime() - 1000),
        categoria: categoria as OrdenServicio["categoria"],
      });

      const plans = planReminders(orden, makeCliente(), NOW);

      expect(plans.filter((p) => p.type === "service_due")).toHaveLength(SCHEDULED.has(categoria) ? 2 : 0);
    });
  });

  // The gate touches only the `completedAt` branch. An appointment reminder is
  // about a booking, not about what the work turned out to be.
  it("leaves the appointment reminder alone for a category that gets no service_due", () => {
    const orden = makeOrden({
      categoria: "revisado",
      appointmentAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    });

    const plans = planReminders(orden, makeCliente(), NOW);

    expect(plans.filter((p) => p.type === "appointment")).toHaveLength(2);
  });
});
