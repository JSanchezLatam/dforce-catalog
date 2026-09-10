import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio } from "@/shared/db/schema";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { APPOINTMENT_LEAD_HOURS, planReminders, SERVICE_DUE_AFTER_DAYS, SERVICE_DUE_ANNUAL_AFTER_DAYS } from "./schedule";

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
 * The owner's rule: a `service_due` reminder follows PREVENTIVE and CORRECTIVE
 * maintenance at 90 days, and REVISADO at 365. `revisado` is Panama's mandatory
 * ANNUAL ATTT inspection — 90 days was always the wrong interval for it, which
 * is why the earlier change dropped it entirely rather than reminding wrong.
 * This is the follow-up that was named there: it comes back at its real
 * interval, off the per-category map in `schedule.ts`.
 *
 * `instalacion` and `reparacion` stay out. A category absent from that map gets
 * no `service_due` at all.
 *
 * Driven off `CATEGORIA_LABEL`'s own keys, PLUS an exhaustiveness assertion —
 * and the second half is the load-bearing one. `describe.each` alone cannot
 * fail by omission: it generates a case for a new key, `SCHEDULED` does not
 * contain it, the title becomes "schedules NO service_due", and it passes.
 * That would default a new category to "does not remind" — inheritance instead
 * of decision, the same shape as the original defect with the sign flipped.
 *
 * So the set is pinned below. A sixth category fails that assertion until
 * somebody edits this list, which is the moment the decision gets made.
 *
 * The group only asserts THAT a reminder exists, never WHEN — a 365-day
 * interval collapsed to 90 would pass every case here. `scheduledFor` for
 * `revisado` is pinned by its own test below.
 */
describe("planReminders — service_due is restricted by category", () => {
  const SCHEDULED = new Set(["mant_preventivo", "mant_correctivo", "revisado"]);
  const KNOWN = ["instalacion", "mant_correctivo", "mant_preventivo", "reparacion", "revisado"];

  it("fails when a category is added, so nobody inherits the reminder decision", () => {
    expect(Object.keys(CATEGORIA_LABEL).sort()).toEqual(KNOWN);
  });

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
  //
  // The example used to be `revisado`, which now DOES get a `service_due` at
  // 365 days — the premise died with this change, so it is re-pointed at
  // `instalacion`, which genuinely gets none.
  it("leaves the appointment reminder alone for a category that gets no service_due", () => {
    const orden = makeOrden({
      categoria: "instalacion",
      appointmentAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
    });

    const plans = planReminders(orden, makeCliente(), NOW);

    expect(plans.filter((p) => p.type === "appointment")).toHaveLength(2);
  });

  /**
   * The interval, not just the existence. REVISADO is an ANNUAL inspection: a
   * test that only asserted "a service_due exists for revisado" would stay
   * green at 90 days and prove nothing, since that is exactly the wrong
   * behaviour this change exists to avoid.
   */
  it("schedules revisado's service_due a full year out, at completedAt + SERVICE_DUE_ANNUAL_AFTER_DAYS", () => {
    const completedAt = new Date("2026-07-01T00:00:00.000Z");
    const orden = makeOrden({ categoria: "revisado", completedAt });

    const plans = planReminders(orden, makeCliente(), NOW);

    const DAY_MS = 24 * 60 * 60 * 1000;
    const expectedTime = new Date(completedAt.getTime() + SERVICE_DUE_ANNUAL_AFTER_DAYS * DAY_MS);
    expect(SERVICE_DUE_ANNUAL_AFTER_DAYS).toBe(365);
    expect(plans.filter((p) => p.type === "service_due")).toEqual([
      expect.objectContaining({ type: "service_due", channel: "whatsapp", scheduledFor: expectedTime }),
      expect.objectContaining({ type: "service_due", channel: "email", scheduledFor: expectedTime }),
    ]);
    // Spelled out so a 90-day regression names the date it actually produced.
    expect(plans[0].scheduledFor).toEqual(new Date("2027-07-01T00:00:00.000Z"));
  });
});
