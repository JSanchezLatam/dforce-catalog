import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { Vehiculo } from "@/shared/db/schema";
import { ClienteValidationError } from "./validation";
import { planVehiculoReconcile, platesSubquery, type VehiculoInput } from "./vehicles";

function vehiculo(overrides: Partial<Vehiculo> = {}): Vehiculo {
  return {
    id: "v1",
    clienteId: "c1",
    make: null,
    model: null,
    year: null,
    plate: "ABC111",
    deactivatedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("platesSubquery (D4)", () => {
  it("breaks the created_at tie on id so the aggregate order is deterministic", () => {
    // `created_at` defaults to `now()`, which is the TRANSACTION timestamp:
    // every row of one batch insert shares it, so ordering on it alone leaves
    // the order of a customer's plates arbitrary. `id` is the tiebreaker.
    expect(new PgDialect().sqlToQuery(platesSubquery()).sql).toContain(
      `order by "vehiculo"."created_at", "vehiculo"."id"`,
    );
  });
});

describe("planVehiculoReconcile (D5)", () => {
  it("leaves every list empty when incoming is omitted (collection untouched, R16)", () => {
    const existing = [vehiculo()];
    expect(planVehiculoReconcile(existing, undefined)).toEqual({ inserts: [], updates: [], deactivate: [] });
  });

  it("deactivates every existing active id when incoming is an empty array", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2" })];
    const plan = planVehiculoReconcile(existing, []);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: ["v1", "v2"] });
  });

  it("plans an insert for an incoming element with no id", () => {
    const incoming: VehiculoInput[] = [{ plate: "XYZ999" }];
    const plan = planVehiculoReconcile([], incoming);
    expect(plan).toEqual({ inserts: [{ plate: "XYZ999" }], updates: [], deactivate: [] });
  });

  it("plans an update for an incoming element whose id matches an existing active vehicle", () => {
    const existing = [vehiculo({ id: "v1", plate: "ABC111" })];
    const incoming: VehiculoInput[] = [{ id: "v1", plate: "ABC222" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({ inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [] });
  });

  it("deactivates an existing vehicle omitted from the incoming payload", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2" })];
    const incoming: VehiculoInput[] = [{ id: "v1", plate: "ABC111" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({ inserts: [], updates: [{ id: "v1", plate: "ABC111" }], deactivate: ["v2"] });
  });

  it("throws rather than silently inserting when an id does not belong to this customer's active vehicles", () => {
    const existing = [vehiculo({ id: "v1" })];
    const incoming: VehiculoInput[] = [{ id: "foreign-id", plate: "ZZZ000" }];
    expect(() => planVehiculoReconcile(existing, incoming)).toThrow(ClienteValidationError);
  });

  it("inserts a brand new row for a re-added plate instead of resurrecting the old (deactivated) one", () => {
    // The previously deactivated vehicle is simply absent from `existing` —
    // callers only ever pass the customer's ACTIVE vehicles in.
    const existing: Vehiculo[] = [];
    const incoming: VehiculoInput[] = [{ plate: "ABC111" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan.inserts).toEqual([{ plate: "ABC111" }]);
    expect(plan.deactivate).toEqual([]);
  });
});
