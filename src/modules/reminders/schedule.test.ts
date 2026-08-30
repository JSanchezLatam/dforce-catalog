import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio } from "@/shared/db/schema";
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
    const plans = planReminders(orden, makeCliente({ phone: null }), NOW);
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
