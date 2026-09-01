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
    expect(planVehiculoReconcile(existing, undefined)).toEqual({ inserts: [], updates: [], deactivate: [], delete: [] });
  });

  it("deactivates every existing active id when incoming is an empty array", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2" })];
    const plan = planVehiculoReconcile(existing, []);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: ["v1", "v2"], delete: [] });
  });

  it("plans an insert for an incoming element with no id", () => {
    const incoming: VehiculoInput[] = [{ plate: "XYZ999" }];
    const plan = planVehiculoReconcile([], incoming);
    expect(plan).toEqual({ inserts: [{ plate: "XYZ999" }], updates: [], deactivate: [], delete: [] });
  });

  it("plans an update for an incoming element whose id matches an existing active vehicle", () => {
    const existing = [vehiculo({ id: "v1", plate: "ABC111" })];
    const incoming: VehiculoInput[] = [{ id: "v1", plate: "ABC222" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({ inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [], delete: [] });
  });

  it("deactivates an existing vehicle omitted from the incoming payload", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2" })];
    const incoming: VehiculoInput[] = [{ id: "v1", plate: "ABC111" }];
    const plan = planVehiculoReconcile(existing, incoming);
    expect(plan).toEqual({ inserts: [], updates: [{ id: "v1", plate: "ABC111" }], deactivate: ["v2"], delete: [] });
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
      delete: [],
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
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: ["v1"], delete: [] });
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
    expect(plan).toEqual({ inserts: [{ plate: "ABC111" }], updates: [], deactivate: ["v-old"], delete: [] });
  });
});

/**
 * A `TxLike` that records the rendered `where` of every write instead of
 * running it. It sees what a statement is SCOPED to; it cannot see row
 * effects, so no test below can prove a write was actually prevented — that
 * is `vehicle search (E2E)`'s job ("ignores a plan naming another customer's
 * vehicle").
 *
 * `selectResult` seeds what the SEAM's `tx.select(...).from(...).where(...).limit(1)`
 * resolves to — `[]` by default (no blocking orders), overridable per-test to
 * simulate a vehicle with existing history.
 */
function recordingTx(selectResult: { id: string }[] = []) {
  const dialect = new PgDialect();
  const wheres: { sql: string; params: unknown[] }[] = [];
  const sets: Record<string, unknown>[] = [];
  const selectCalls: unknown[] = [];
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
    delete: () => ({
      where: async (clause: SQL) => {
        wheres.push(dialect.sqlToQuery(clause));
      },
    }),
    select: (...args: unknown[]) => {
      selectCalls.push(args);
      return {
        from: () => ({
          where: () => ({
            limit: async () => selectResult,
          }),
        }),
      };
    },
  } as unknown as TxLike;
  return { tx, wheres, sets, selectCalls };
}

describe("applyVehiculoPlan (D5)", () => {
  // `planVehiculoReconcile` rejects a foreign id, but that is a caller-side
  // invariant: `applyVehiculoPlan` takes any plan handed to it, and the
  // module's own docstring calls ownership "a trust boundary". A trust
  // boundary that only holds when the caller got it right is not one, so both
  // mutating statements carry the `clienteId` they were already given.
  it("scopes an update to the owning customer, not to the vehicle id alone", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [], delete: [] });
    expect(wheres).toHaveLength(1);
    expect(wheres[0].params).toContain("c1");
  });

  it("scopes a deactivate to the owning customer, not to the vehicle ids alone", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: ["v1", "v2"], delete: [] });
    expect(wheres).toHaveLength(1);
    expect(wheres[0].params).toContain("c1");
  });

  // D5 restore is EXPLICIT: `deactivated: false` on the payload is what
  // reactivates a row. An update that says nothing about activation state
  // must leave `deactivated_at` exactly as it found it — otherwise GET the
  // detail, PATCH it back unchanged silently resurrects every soft delete.
  it("leaves deactivated_at untouched on an update that does not name an activation state", async () => {
    const { tx, sets } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [{ id: "v1", plate: "ABC222" }], deactivate: [], delete: [] });
    expect(sets[0]).not.toHaveProperty("deactivatedAt");
  });

  it("clears deactivatedAt only when the payload explicitly asks for the vehicle to be active", async () => {
    const { tx, sets } = recordingTx();
    await applyVehiculoPlan(tx, "c1", {
      inserts: [],
      updates: [{ id: "v1", plate: "ABC222", deactivated: false }],
      deactivate: [],
      delete: [],
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

/**
 * Delete is the plan's FOURTH outcome, not a second endpoint: deactivate says
 * "the car left the customer, keep the history"; delete says "this row should
 * never have existed". The two must never collapse into each other, so every
 * case below also pins what the OTHER lists do not contain.
 */
describe("planVehiculoReconcile — permanent delete (D5)", () => {
  it("plans a delete for an existing id the payload marks deleted, and neither updates nor deactivates it", () => {
    const existing = [vehiculo({ id: "v1" }), vehiculo({ id: "v2", plate: "BBB222" })];
    const plan = planVehiculoReconcile(existing, [
      { id: "v2", plate: "BBB222" },
      { id: "v1", plate: "ABC111", deleted: true },
    ]);
    expect(plan.delete).toEqual(["v1"]);
    expect(plan.updates.map((u) => u.id)).toEqual(["v2"]);
    // Deactivating a row that is about to be deleted would write a doomed
    // tuple and — once the orden_servicio FK lands and delete can be refused —
    // silently soft-delete a vehicle the staff member asked to keep or remove,
    // never to deactivate.
    expect(plan.deactivate).toEqual([]);
  });

  it("deletes an ALREADY-deactivated vehicle without re-stamping its deactivated_at", () => {
    const existing = [vehiculo({ id: "v1", deactivatedAt: new Date("2026-01-02") })];
    const plan = planVehiculoReconcile(existing, [{ id: "v1", plate: "ABC111", deleted: true }]);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: [], delete: ["v1"] });
  });

  it("still rejects a foreign id, even when the payload calls it a delete", () => {
    const existing = [vehiculo({ id: "v1" })];
    expect(() =>
      planVehiculoReconcile(existing, [{ id: "otro-cliente", plate: "ZZZ000", deleted: true }]),
    ).toThrow(ClienteValidationError);
  });

  it("ignores an id-less element marked deleted rather than inserting the row it asked to remove", () => {
    const plan = planVehiculoReconcile([], [{ plate: "XYZ999", deleted: true }]);
    expect(plan).toEqual({ inserts: [], updates: [], deactivate: [], delete: [] });
  });
});

describe("applyVehiculoPlan — permanent delete (D5)", () => {
  it("scopes the delete to the owning customer, not to the vehicle ids alone", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: ["v1", "v2"] });
    expect(wheres).toHaveLength(1);
    expect(wheres[0].params).toContain("c1");
  });

  it("issues no delete statement at all for an empty delete list", async () => {
    const { tx, wheres } = recordingTx();
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: [] });
    expect(wheres).toHaveLength(0);
  });
});

/**
 * The SEAM (C4, design.md D4) — the referential-integrity check
 * `applyVehiculoPlan`'s docstring specified ~L269, filled once `orden_servicio`
 * gained `vehiculoId`. Runs inside the same `tx`, immediately above the DELETE.
 */
describe("applyVehiculoPlan — SEAM: permanent delete refused when service history exists (C4, D4)", () => {
  it("throws ClienteValidationError under the bare vehicles key when the select finds a blocking order", async () => {
    const { tx } = recordingTx([{ id: "orden-1" }]);
    await expect(
      applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: ["v1"] }),
    ).rejects.toThrow(ClienteValidationError);

    try {
      await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: ["v1"] });
    } catch (err) {
      expect(err).toBeInstanceOf(ClienteValidationError);
      expect((err as ClienteValidationError).errors).toHaveProperty("vehicles");
    }
  });

  it("does NOT delete the row when the SEAM refuses — no delete statement is issued", async () => {
    const { tx, wheres } = recordingTx([{ id: "orden-1" }]);
    await expect(
      applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: ["v1"] }),
    ).rejects.toThrow(ClienteValidationError);
    // The delete's own `where` push never runs — the throw happens above it.
    expect(wheres).toHaveLength(0);
  });

  it("proceeds with the delete when the select finds no blocking order", async () => {
    const { tx, wheres } = recordingTx([]);
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: [], delete: ["v1"] });
    expect(wheres).toHaveLength(1);
  });

  it("never calls select for a deactivate-only plan — the asymmetry is structural, not conditional", async () => {
    const { tx, selectCalls } = recordingTx([{ id: "orden-1" }]);
    await applyVehiculoPlan(tx, "c1", { inserts: [], updates: [], deactivate: ["v1"], delete: [] });
    expect(selectCalls).toHaveLength(0);
  });
});
