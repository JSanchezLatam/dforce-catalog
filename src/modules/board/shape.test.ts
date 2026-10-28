import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CUSTOMER_STATUS } from "@/modules/portal-sync/snapshot";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { toBoardSnapshot, toCustomerSnapshot, type BoardOrderRow } from "./shape";

const NOW = new Date("2026-10-26T15:00:00.000Z");
const T0 = new Date("2026-10-26T14:00:00.000Z");
const LEAK = "__LEAK__";

/** The columns the query selects, plus every field the query must never select, each holding the sentinel. */
const poisoned = (extra: Partial<BoardOrderRow> = {}): BoardOrderRow =>
  ({
    id: "ord-1",
    status: "in_progress",
    esperaMotivo: null,
    updatedAt: T0,
    appointmentAt: null,
    urgenteAt: null,
    // selected for the kanban mapper only: the TV rows must never carry them
    vehiculoId: LEAK,
    categoria: LEAK,
    plate: "AB1234",
    make: "Toyota",
    model: "Hilux",
    // never-selected fields: cliente.*, order text, internal vehicle fields, technician fields
    name: LEAK,
    phone: LEAK,
    email: LEAK,
    portalToken: LEAK,
    clienteId: LEAK,
    description: LEAK,
    hallazgos: LEAK,
    recomendaciones: LEAK,
    chasis: LEAK,
    colorPrimario: LEAK,
    seguroVence: LEAK,
    userId: LEAK,
    ...extra,
  }) as BoardOrderRow;

const row = (id: string, status: OrderStatus, extra: Partial<BoardOrderRow> = {}) => poisoned({ id, status, ...extra });

describe("workshop board mapper: toBoardSnapshot()", () => {
  it("Sentinel poison never leaks: nothing outside the whitelist reaches the payload", () => {
    const techs = [{ ordenId: "ord-1", nombre: "Ana", userId: LEAK, deactivatedAt: LEAK } as { ordenId: string; nombre: string }];
    const snapshot = toBoardSnapshot([poisoned()], techs, [], NOW);

    expect(JSON.stringify(snapshot)).not.toContain(LEAK);
    expect(JSON.stringify(snapshot)).not.toContain("ord-1");
  });

  it("row keys equal the whitelist exactly", () => {
    const [r] = toBoardSnapshot([poisoned()], [], [], NOW).rows;

    expect(Object.keys(r).sort()).toEqual(["holdReason", "make", "model", "plate", "status", "statusLabel", "statusSince", "technicians", "urgent"]);
    expect(r).toEqual({
      status: "in_progress",
      statusLabel: "En progreso",
      plate: "AB1234",
      make: "Toyota",
      model: "Hilux",
      holdReason: null,
      technicians: [],
      statusSince: T0.toISOString(),
      urgent: false,
    });
  });

  it("Urgent flag reaches the row as a boolean, and the flagging timestamp does not", () => {
    const flaggedAt = new Date("2026-10-26T13:00:00.000Z");
    const rows = toBoardSnapshot([row("a", "open", { urgenteAt: flaggedAt }), row("b", "open")], [], [], NOW).rows;

    expect(rows.map((r) => r.urgent)).toEqual([true, false]);
    expect(JSON.stringify(rows)).not.toContain(flaggedAt.toISOString());
  });

  it("Urgent first within a status: a newer urgent row precedes an older non-urgent one", () => {
    const old = new Date("2026-10-26T08:00:00.000Z");
    const rows = toBoardSnapshot(
      [row("old", "in_progress", { updatedAt: old }), row("hot", "in_progress", { updatedAt: T0, urgenteAt: T0 }), row("d", "open")],
      [],
      [],
      NOW,
    ).rows;

    expect(rows.map((r) => [r.status, r.urgent, r.statusSince])).toEqual([
      ["open", false, T0.toISOString()],
      ["in_progress", true, T0.toISOString()],
      ["in_progress", false, old.toISOString()],
    ]);
  });

  it("Hold reason only while on hold: on_hold shows the Spanish label, in_progress carries none", () => {
    const rows = toBoardSnapshot(
      [row("a", "on_hold", { esperaMotivo: "repuesto" }), row("b", "in_progress", { esperaMotivo: "repuesto" })],
      [],
      [],
      NOW,
    ).rows;

    expect(rows.find((r) => r.status === "on_hold")?.holdReason).toBe("Repuesto");
    expect(rows.find((r) => r.status === "in_progress")?.holdReason).toBeNull();
  });

  it("appointmentAt only while booked", () => {
    const appointment = new Date("2026-10-27T13:00:00.000Z");
    const rows = toBoardSnapshot(
      [row("a", "booked", { appointmentAt: appointment }), row("b", "open", { appointmentAt: appointment })],
      [],
      [],
      NOW,
    ).rows;

    expect(rows.find((r) => r.status === "booked")?.appointmentAt).toBe(appointment.toISOString());
    expect(rows.find((r) => r.status === "open")).not.toHaveProperty("appointmentAt");
  });

  it("Booked order without a vehicle: Sin vehículo, Agendada, technician and appointment, no throw", () => {
    const appointment = new Date("2026-10-27T13:00:00.000Z");
    const booked = row("a", "booked", { plate: null, make: null, model: null, appointmentAt: appointment });

    const [r] = toBoardSnapshot([booked], [{ ordenId: "a", nombre: "Ana" }], [], NOW).rows;

    expect(r).toMatchObject({ plate: "Sin vehículo", make: null, model: null, statusLabel: "Agendada", technicians: ["Ana"], appointmentAt: appointment.toISOString() });
  });

  it("time in status is the latest history instant, falling back to updatedAt", () => {
    const hist = new Date("2026-10-26T13:00:00.000Z");
    const rows = toBoardSnapshot([row("a", "open"), row("b", "open", { updatedAt: T0 })], [], [{ ordenId: "a", changedAt: hist }], NOW).rows;

    expect(rows.map((r) => r.statusSince)).toEqual([hist.toISOString(), T0.toISOString()]);
  });

  it("technicians are matched to their own order only", () => {
    const rows = toBoardSnapshot(
      [row("a", "open"), row("b", "open")],
      [
        { ordenId: "a", nombre: "Ana" },
        { ordenId: "b", nombre: "Beto" },
        { ordenId: "b", nombre: "Cris" },
      ],
      [],
      NOW,
    ).rows;

    expect(rows.map((r) => r.technicians)).toEqual([["Ana"], ["Beto", "Cris"]]);
  });

  it("Ordering is stable: spec status order, then longest time in status first", () => {
    const old = new Date("2026-10-26T08:00:00.000Z");
    const rows = toBoardSnapshot(
      [row("d", "done"), row("o1", "open", { updatedAt: T0 }), row("b", "booked"), row("o2", "open", { updatedAt: old }), row("h", "on_hold", { esperaMotivo: "repuesto" })],
      [],
      [],
      NOW,
    ).rows;

    expect(rows.map((r) => r.status)).toEqual(["booked", "open", "open", "on_hold", "done"]);
    expect(rows[1].statusSince).toBe(old.toISOString());
  });

  it("stamps generatedAt as an ISO string", () => {
    expect(toBoardSnapshot([], [], [], NOW).generatedAt).toBe(NOW.toISOString());
  });
});

describe("customer view mapper: toCustomerSnapshot()", () => {
  it("Only four fields: keys equal plate, make, model, status and no sentinel appears", () => {
    const snapshot = toCustomerSnapshot([row("a", "on_hold", { esperaMotivo: "repuesto" })], NOW);

    expect(JSON.stringify(snapshot)).not.toContain(LEAK);
    expect(Object.keys(snapshot.rows[0]).sort()).toEqual(["make", "model", "plate", "status"]);
    expect(JSON.stringify(snapshot)).not.toContain("ord-1");
  });

  it.each(["open", "diagnosing", "in_progress", "on_hold", "ready_for_review", "done"] as const)(
    "Labels equal the portal's: %s",
    (status) => {
      expect(toCustomerSnapshot([row("a", status)], NOW).rows[0].status).toBe(CUSTOMER_STATUS[status]);
    },
  );

  it("drops orders with no vehicle", () => {
    const rows = toCustomerSnapshot([row("a", "open", { plate: null, make: null, model: null }), row("b", "open")], NOW).rows;

    expect(rows).toHaveLength(1);
  });

  it("Plate shown unmasked", () => {
    expect(toCustomerSnapshot([row("a", "open")], NOW).rows[0]).toEqual({ plate: "AB1234", make: "Toyota", model: "Hilux", status: "Recibida" });
  });

  it("never lets booked or cancelled reach the waiting room, even if a query passed them", () => {
    expect(toCustomerSnapshot([row("a", "booked"), row("b", "cancelled")], NOW).rows).toEqual([]);
  });

  it("the board holds no status map of its own: shape.ts takes labels from CUSTOMER_STATUS", () => {
    const source = readFileSync(join(__dirname, "shape.ts"), "utf8");

    expect(source).toMatch(/CUSTOMER_STATUS/);
    expect(source).not.toMatch(/Recibida|En proceso|Terminada/);
  });
});
