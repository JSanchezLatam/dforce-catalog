import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { Vehiculo } from "@/shared/db/schema";
import { ClienteValidationError } from "./validation";
import {
  applyVehiculoPlan,
  listVehiculosByCliente,
  planVehiculoReconcile,
  platesSubquery,
  type TxLike,
  type VehiculoInput,
} from "./vehicles";

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

  it("throws rather than silently inserting when an id does not belong to this customer at all", () => {
    const existing = [vehiculo({ id: "v1" })];
    const incoming: VehiculoInput[] = [{ id: "foreign-id", plate: "ZZZ000" }];
    expect(() => planVehiculoReconcile(existing, incoming)).toThrow(ClienteValidationError);
  });

  /**
   * Restore (spec: "Vehicle Collection Persistence") means the client resends
   * a previously-deactivated vehicle's id WITH `deactivated: false`. `existing`
   * therefore has to carry BOTH active and inactive vehicles — `getClienteById`
   * now fetches the whole collection (`listVehiculosByCliente(id, {
   * includeInactive: true })`) so the ownership check below has something to
   * match against; rejecting an inactive vehicle's own id as "foreign" would
   * make restore impossible.
   */
  it("plans an update (never a rejection) for an id belonging to an inactive existing vehicle — this is how restore works", () => {
    const existing = [vehiculo({ id: "v1", deactivatedAt: new Date("2026-01-02") })];
    const incoming: VehiculoInput[] = [{ id: "v1", plate: "ABC111", deactivated: false }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({
      inserts: [],
      updates: [{ id: "v1", plate: "ABC111", deactivated: false }],
      deactivate: [],
    });
  });

  /**
   * The round trip any client does by default: GET the detail — which now
   * returns inactive vehicles so restore has an id to act on — and PATCH the
   * same collection straight back. Nothing changed, so nothing may change.
   * Including a row is not a restore request; only `deactivated: false` is.
   */
  it("plans no change at all for an unchanged payload that carries a deactivated vehicle", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2", deactivatedAt: new Date("2026-01-02") })];
    const incoming: VehiculoInput[] = [
      { id: "v1", plate: "ABC111" },
      { id: "v2", plate: "ZZZ999", deactivated: true },
    ];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan.inserts).toEqual([]);
    expect(plan.deactivate).toEqual([]);
  });

  it("deactivates an active vehicle the payload marks deactivated, rather than only inferring it from omission", () => {
    const existing = [vehiculo({ id: "v1" })];
    const plan = planVehiculoReconcile(existing, [{ id: "v1", plate: "ABC111", deactivated: true }]);
    expect(plan.deactivate).toEqual(["v1"]);
  });

  it("never re-stamps an already-inactive vehicle omitted from incoming — deactivate only ever touches active rows", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2", deactivatedAt: new Date("2026-01-02") })];
    const plan = planVehiculoReconcile(existing, []);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: ["v1"] });
  });

  it("keys on id, never plate: an id-less element whose plate already exists inserts a new row and drops the old", () => {
    // The mechanism behind D5's no-resurrection rule. `existing` holds only
    // ACTIVE vehicles, so a deactivated row is never visible here at all —
    // this function CANNOT observe resurrection, and a fixture pretending
    // otherwise would assert a shape the contract says never reaches it.
    // What it can observe is the reason resurrection is impossible: a plate
    // collision is not a match. A plate-keyed implementation would return
    // `updates: [{ id: "v-old", ... }]` here. The full lifecycle, with a real
    // `deactivated_at`, is pinned by `vehicle search (E2E)`.
    const existing = [vehiculo({ id: "v-old", plate: "ABC111" })];
    const incoming: VehiculoInput[] = [{ plate: "ABC111" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({ inserts: [{ plate: "ABC111" }], updates: [], deactivate: ["v-old"] });
  });
});

/**
 * A `TxLike` that records the rendered `where` of every write instead of
 * running it. It sees what a statement is SCOPED to; it cannot see row
 * effects, so no test below can prove a write was actually prevented — that
 * is `vehicle search (E2E)`'s job ("ignores a plan naming another customer's
 * vehicle").
 */
function recordingTx() {
  const dialect = new PgDialect();
  const wheres: { sql: string; params: unknown[] }[] = [];
  const sets: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({ values: async () => undefined }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        sets.push(patch);
        return {
          where: async (clause: SQL) => {
            wheres.push(dialect.sqlToQuery(clause));
          },
        };
      },
    }),
    select: () => undefined,
  } as unknown as TxLike;
  return { tx, wheres, sets };
}

describe("applyVehiculoPlan (D5)", () => {
  // `planVehiculoReconcile` rejects a foreign id, but that is a caller-side
  // invariant: `applyVehiculoPlan` takes any plan handed to it, and the
  // module's own docstring calls ownership "a trust boundary". A trust
  // boundary that only holds when the caller got it right is not one, so both
  // mutating statements carry the `clienteId` they were already given.
  it("scopes an update to the owning customer, not to the vehicle id alone", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [] });
    expect(wheres).toHaveLength(1);
    expect(wheres[0].params).toContain("c1");
  });

  it("scopes a deactivate to the owning customer, not to the vehicle ids alone", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: ["v1", "v2"] });
    expect(wheres).toHaveLength(1);
    expect(wheres[0].params).toContain("c1");
  });

  // D5 restore is EXPLICIT: `deactivated: false` on the payload is what
  // reactivates a row. An update that says nothing about activation state
  // must leave `deactivated_at` exactly as it found it — otherwise GET the
  // detail, PATCH it back unchanged silently resurrects every soft delete.
  it("leaves deactivated_at untouched on an update that does not name an activation state", async () => {
    const { tx, sets } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [] });
    expect(sets[0]).not.toHaveProperty("deactivatedAt");
  });

  it("clears deactivatedAt only when the payload explicitly asks for the vehicle to be active", async () => {
    const { tx, sets } = recordingTx();
    await applyVehiculoPlan(tx, "c1", {
      inserts: [],
      updates: [{ id: "v1", plate: "ABC222", deactivated: false }],
      deactivate: [],
    });
    expect(sets[0]).toMatchObject({ deactivatedAt: null });
  });

  /** The whole round trip, plan + apply: the deactivated row survives it. */
  it("does not resurrect a soft-deleted vehicle when an unchanged collection is sent back", async () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2", deactivatedAt: new Date("2026-01-02") })];
    const { tx, sets } = recordingTx();
    await applyVehiculoPlan(
      tx,
      "c1",
      planVehiculoReconcile(existing, [
        { id: "v1", plate: "ABC111" },
        { id: "v2", plate: "ZZZ999", deactivated: true },
      ]),
    );
    expect(sets.some((patch) => "deactivatedAt" in patch)).toBe(false);
  });
});

describe("listVehiculosByCliente (R16, restore)", () => {
  it("defaults to active-only", async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    await listVehiculosByCliente("c1", undefined, queryFn);
    expect(queryFn).toHaveBeenCalledWith(false);
  });

  it("fetches the whole collection, active and inactive, when includeInactive is opted in", async () => {
    // `getClienteById` needs this: the detail view and `CustomerForm`'s
    // restore action both need to see an inactive vehicle to offer it back.
    const queryFn = vi.fn().mockResolvedValue([]);
    await listVehiculosByCliente("c1", { includeInactive: true }, queryFn);
    expect(queryFn).toHaveBeenCalledWith(true);
  });
});
