import { describe, expect, it } from "vitest";

import type { IngestBody, PortalOrder, PortalVehicle } from "../contract";
import { parseIngest } from "./parse";

const order: PortalOrder = {
  id: "o1",
  status: "En proceso",
  categoria: "Mecánica",
  createdAt: "2026-10-01T10:00:00.000Z",
  appointmentAt: null,
  completedAt: null,
  description: "Cambio de aceite",
  hallazgos: null,
  recomendaciones: null,
};
const vehicle: PortalVehicle = { id: "v1", plate: "AB1234", make: "Toyota", model: null, year: 2015, orders: [order] };
const upsert: IngestBody = {
  kind: "upsert",
  clienteId: "c1",
  version: 5,
  tokenHash: "a".repeat(64),
  generatedAt: "2026-10-01T10:00:00.000Z",
  vehicles: [vehicle],
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parseIngest", () => {
  it("accepts the three wire shapes unchanged", () => {
    expect(parseIngest(clone(upsert))).toEqual({ ok: true, body: upsert });
    const del: IngestBody = { kind: "delete", clienteId: "c1", version: 7 };
    expect(parseIngest(clone(del))).toEqual({ ok: true, body: del });
    const rec: IngestBody = { kind: "reconcile", liveClienteIds: ["c1", "c2"], maxVersion: 9 };
    expect(parseIngest(clone(rec))).toEqual({ ok: true, body: rec });
  });

  it("rejects a wrong or missing kind and non-objects", () => {
    for (const bad of [null, [], "x", 3, {}, { ...upsert, kind: "purge" }]) {
      expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an extra key at every level", () => {
    const top = { ...clone(upsert), phone: "555" };
    const veh = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (veh.vehicles[0] as Record<string, unknown>).chasis = "X";
    const ord = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (ord.vehicles[0].orders[0] as Record<string, unknown>).observaciones = "secret";
    const del = { kind: "delete", clienteId: "c1", version: 1, tokenHash: "h" };
    const rec = { kind: "reconcile", liveClienteIds: [], maxVersion: 1, extra: 1 };
    for (const bad of [top, veh, ord, del, rec]) expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it("rejects a missing required field at every level", () => {
    for (const drop of ["clienteId", "version", "tokenHash", "generatedAt", "vehicles"]) {
      const bad = clone(upsert) as Record<string, unknown>;
      delete bad[drop];
      expect(parseIngest(bad).ok, drop).toBe(false);
    }
    const veh = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    delete (veh.vehicles[0] as Partial<PortalVehicle>).plate;
    expect(parseIngest(veh).ok).toBe(false);
    const ord = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    delete (ord.vehicles[0].orders[0] as Partial<PortalOrder>).hallazgos;
    expect(parseIngest(ord).ok).toBe(false);
  });

  it("rejects a status outside the four labels, including internal ones", () => {
    for (const status of ["in_progress", "ready_for_review", "Abierta", ""]) {
      const bad = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
      (bad.vehicles[0].orders[0] as { status: string }).status = status;
      expect(parseIngest(bad).ok, status).toBe(false);
    }
    for (const status of ["Recibida", "En proceso", "Terminada", "Cancelada"]) {
      const good = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
      (good.vehicles[0].orders[0] as { status: string }).status = status;
      expect(parseIngest(good).ok, status).toBe(true);
    }
  });

  it("rejects wrong types: version, year, ids list, empty strings", () => {
    const wrong: unknown[] = [
      { ...upsert, version: "5" },
      { ...upsert, version: 1.5 },
      { ...upsert, version: -1 },
      { ...upsert, clienteId: "" },
      { ...upsert, tokenHash: "" },
      { ...upsert, vehicles: "none" },
      { kind: "delete", clienteId: "c1", version: "7" },
      { kind: "reconcile", liveClienteIds: "c1", maxVersion: 1 },
      { kind: "reconcile", liveClienteIds: [1], maxVersion: 1 },
      { kind: "reconcile", liveClienteIds: [], maxVersion: "1" },
    ];
    for (const bad of wrong) expect(parseIngest(bad).ok, JSON.stringify(bad)).toBe(false);
    const year = clone(upsert) as Extract<IngestBody, { kind: "upsert" }>;
    (year.vehicles[0] as { year: unknown }).year = "2015";
    expect(parseIngest(year).ok).toBe(false);
  });
});
