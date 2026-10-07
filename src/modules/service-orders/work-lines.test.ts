import { describe, expect, it } from "vitest";

import type { db } from "@/shared/db/client";
import { OrderClosedError, OrderEditForbiddenError } from "./order-lock";
import { SYSTEM_SCOPE } from "./scope";
import { OrdenServicioNotFoundError } from "./service";
import type { OrderStatus } from "./transitions";
import {
  addWorkLine,
  deleteWorkLine,
  updateWorkLine,
  WorkLineForbiddenError,
  WorkLineNotFoundError,
  WorkLineRefusedError,
  WorkLineValidationError,
} from "./work-lines";

/**
 * Answers by statement order, as `assignments.test.ts` does: the Nth awaited
 * statement gets the Nth queued result (an `Error` is thrown instead). Records
 * every `.values(...)`, `.set(...)` and the table each statement targets.
 */
function fakeDb(results: unknown[]) {
  const log = { values: [] as unknown[], sets: [] as unknown[], statements: 0, deletes: 0 };
  let next = 0;
  const statement = () => {
    const chain: unknown = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") {
          log.statements += 1;
          const result = results[next++] ?? [];
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            result instanceof Error ? reject(result) : Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (prop === "values") log.values.push(args[0]);
          if (prop === "set") log.sets.push(args[0]);
          return chain;
        };
      },
    });
    return chain;
  };
  const tx = {
    select: statement,
    insert: statement,
    update: statement,
    delete: () => {
      log.deletes += 1;
      return statement();
    },
  };
  return {
    database: { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as typeof db,
    log,
  };
}

const order = (status: OrderStatus) => [{ id: "o1", status }];
const OWN = [{ id: "t1" }]; // the técnico's roster row
const ASSIGNED = [{ parteListaAt: null }];
const MARKED = [{ parteListaAt: new Date("2026-10-06") }];
const LINE = [{ id: "l1", ordenId: "o1", tecnicoId: "t1", descripcion: "Cambio de pastillas", duracionMinutos: 30, fecha: "2026-10-05" }];

const staff = { id: "admin-1", canManageAll: true };
const tecnicoUser = { id: "user-t", canManageAll: false };
const base = { ordenId: "o1", tecnicoId: "t1", descripcion: "Cambio de pastillas", duracionMinutos: 90, scope: SYSTEM_SCOPE };
const grant = { correctorId: "admin-1" };

describe("addWorkLine: validation", () => {
  it.each([0, -5, 1.5, "abc", 1441, null, undefined, "90"])(
    "refuses duration %j in Spanish and touches the database not at all",
    async (duracionMinutos) => {
      const { database, log } = fakeDb([]);
      const err = await addWorkLine({ ...base, duracionMinutos, actor: staff }, { db: database }).catch((e) => e);
      expect(err).toBeInstanceOf(WorkLineValidationError);
      expect(err.errors.duracionMinutos).toBe("Los minutos tienen que ser un entero entre 1 y 1440");
      expect(log.statements).toBe(0);
    },
  );

  it.each(["", "   ", undefined, 5])("refuses description %j", async (descripcion) => {
    const { database } = fakeDb([]);
    const err = await addWorkLine({ ...base, descripcion, actor: staff }, { db: database }).catch((e) => e);
    expect(err).toBeInstanceOf(WorkLineValidationError);
    expect(err.errors.descripcion).toBe("Escribí qué se hizo");
  });

  it("refuses a description over 1000 characters", async () => {
    const { database } = fakeDb([]);
    await expect(addWorkLine({ ...base, descripcion: "x".repeat(1001), actor: staff }, { db: database })).rejects.toBeInstanceOf(
      WorkLineValidationError,
    );
  });

  it.each(["2026-02-30", "05/10/2026", 20261005])("refuses date %j", async (fecha) => {
    const { database } = fakeDb([]);
    const err = await addWorkLine({ ...base, fecha, actor: staff }, { db: database }).catch((e) => e);
    expect(err).toBeInstanceOf(WorkLineValidationError);
    expect(err.errors.fecha).toBe("La fecha no es válida");
  });

  it("defaults fecha to today in Panama, not UTC (03:00Z is still the previous evening there)", async () => {
    const { database, log } = fakeDb([order("in_progress"), ASSIGNED, [{ id: "l1" }]]);
    await addWorkLine({ ...base, actor: staff }, { db: database, now: () => new Date("2026-10-08T03:00:00Z") });
    expect(log.values[0]).toMatchObject({ fecha: "2026-10-07" });
  });

  it("trims the description and stamps created_by with the actor", async () => {
    const { database, log } = fakeDb([order("in_progress"), ASSIGNED, [{ id: "l1" }]]);
    await addWorkLine({ ...base, descripcion: "  Cambio  ", fecha: "2026-10-05", actor: staff }, { db: database });
    expect(log.values).toEqual([
      { ordenId: "o1", tecnicoId: "t1", descripcion: "Cambio", duracionMinutos: 90, fecha: "2026-10-05", createdBy: "admin-1" },
    ]);
  });
});

describe("addWorkLine: who and when", () => {
  it.each<OrderStatus>(["in_progress", "ready_for_review"])("lets staff write on a %s order", async (status) => {
    const { database } = fakeDb([order(status), ASSIGNED, [{ id: "l1" }]]);
    await expect(addWorkLine({ ...base, actor: staff }, { db: database })).resolves.toEqual({ id: "l1" });
  });

  it("lets a técnico write their own line on an in_progress order", async () => {
    const { database } = fakeDb([order("in_progress"), OWN, ASSIGNED, [{ id: "l1" }]]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).resolves.toEqual({ id: "l1" });
  });

  it("refuses a técnico naming another technician with 403-class error and writes nothing", async () => {
    const { database, log } = fakeDb([order("in_progress"), [{ id: "t-other" }]]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(WorkLineForbiddenError);
    expect(log.values).toEqual([]);
  });

  it("refuses a técnico with no roster row", async () => {
    const { database } = fakeDb([order("in_progress"), []]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(WorkLineForbiddenError);
  });

  it("refuses a técnico on a ready_for_review order", async () => {
    const { database, log } = fakeDb([order("ready_for_review")]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(OrderEditForbiddenError);
    expect(log.values).toEqual([]);
  });

  it.each([staff, tecnicoUser])("refuses an open order for every role", async (actor) => {
    const { database, log } = fakeDb([order("open")]);
    await expect(addWorkLine({ ...base, actor }, { db: database })).rejects.toBeInstanceOf(OrderEditForbiddenError);
    expect(log.values).toEqual([]);
  });

  it("refuses a technician who is not assigned to the order", async () => {
    const { database, log } = fakeDb([order("in_progress"), []]);
    const err = await addWorkLine({ ...base, actor: staff }, { db: database }).catch((e) => e);
    expect(err).toBeInstanceOf(WorkLineValidationError);
    expect(err.errors.tecnicoId).toBe("Ese técnico no está asignado a la orden");
    expect(log.values).toEqual([]);
  });

  it("refuses a técnico who marked their part, until they un-mark", async () => {
    const { database, log } = fakeDb([order("in_progress"), OWN, MARKED]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(WorkLineRefusedError);
    expect(log.values).toEqual([]);
  });

  it("answers an order the scope cannot see as not found", async () => {
    const { database } = fakeDb([[]]);
    await expect(addWorkLine({ ...base, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(OrdenServicioNotFoundError);
  });

  it("evaluates the status of the LOCKED row: a done order refuses, whatever the caller saw", async () => {
    const { database, log } = fakeDb([order("done")]);
    await expect(addWorkLine({ ...base, actor: staff }, { db: database })).rejects.toBeInstanceOf(OrderClosedError);
    expect(log.values).toEqual([]);
    expect(log.statements).toBe(1);
  });
});

describe("updateWorkLine", () => {
  const patchBase = { ordenId: "o1", lineId: "l1", scope: SYSTEM_SCOPE };

  it("lets staff edit during review and writes only the supplied columns (+ updated_at)", async () => {
    const { database, log } = fakeDb([order("ready_for_review"), LINE, []]);
    await updateWorkLine({ ...patchBase, patch: { duracionMinutos: 45 }, actor: staff }, { db: database });
    expect(log.sets).toEqual([{ duracionMinutos: 45, updatedAt: expect.any(Date) }]);
  });

  it("cannot change the technician or the order: those keys are never written", async () => {
    const { database, log } = fakeDb([order("in_progress"), LINE, []]);
    const patch = { duracionMinutos: 45, tecnicoId: "t-other", ordenId: "o-other" } as never;
    await updateWorkLine({ ...patchBase, patch, actor: staff }, { db: database });
    expect(Object.keys(log.sets[0] as object).sort()).toEqual(["duracionMinutos", "updatedAt"]);
  });

  it("validates the supplied fields only", async () => {
    const { database } = fakeDb([]);
    await expect(updateWorkLine({ ...patchBase, patch: { duracionMinutos: 0 }, actor: staff }, { db: database })).rejects.toBeInstanceOf(
      WorkLineValidationError,
    );
  });

  it("refuses an empty patch", async () => {
    const { database } = fakeDb([]);
    await expect(updateWorkLine({ ...patchBase, patch: {}, actor: staff }, { db: database })).rejects.toBeInstanceOf(
      WorkLineValidationError,
    );
  });

  it("answers a line that is not on this order as not found", async () => {
    const { database, log } = fakeDb([order("in_progress"), []]);
    await expect(updateWorkLine({ ...patchBase, patch: { fecha: "2026-10-05" }, actor: staff }, { db: database })).rejects.toBeInstanceOf(
      WorkLineNotFoundError,
    );
    expect(log.sets).toEqual([]);
  });

  it("refuses a técnico editing another technician's line", async () => {
    const { database, log } = fakeDb([order("in_progress"), LINE, [{ id: "t-other" }]]);
    await expect(updateWorkLine({ ...patchBase, patch: { fecha: "2026-10-05" }, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(
      WorkLineForbiddenError,
    );
    expect(log.sets).toEqual([]);
  });

  it("refuses a marked técnico", async () => {
    const { database } = fakeDb([order("in_progress"), LINE, OWN, MARKED]);
    await expect(updateWorkLine({ ...patchBase, patch: { fecha: "2026-10-05" }, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(
      WorkLineRefusedError,
    );
  });
});

describe("deleteWorkLine", () => {
  const ids = { ordenId: "o1", lineId: "l1", scope: SYSTEM_SCOPE };

  it("deletes the line on an in_progress order, with no audit row", async () => {
    const { database, log } = fakeDb([order("in_progress"), LINE, []]);
    await deleteWorkLine({ ...ids, actor: staff }, { db: database });
    expect(log.deletes).toBe(1);
    expect(log.values).toEqual([]);
  });

  it("refuses a técnico deleting another technician's line", async () => {
    const { database, log } = fakeDb([order("in_progress"), LINE, [{ id: "t-other" }]]);
    await expect(deleteWorkLine({ ...ids, actor: tecnicoUser }, { db: database })).rejects.toBeInstanceOf(WorkLineForbiddenError);
    expect(log.deletes).toBe(0);
  });

  it("refuses a line that is not on this order", async () => {
    const { database } = fakeDb([order("in_progress"), []]);
    await expect(deleteWorkLine({ ...ids, actor: staff }, { db: database })).rejects.toBeInstanceOf(WorkLineNotFoundError);
  });
});

describe("work lines under correction (closed order)", () => {
  const audit = (field: string, oldValue: string | null, newValue: string | null) => [
    { ordenId: "o1", userId: "admin-1", field, oldValue, newValue },
  ];

  it("add: writes `linea_trabajo` (null, id) after the line", async () => {
    const { database, log } = fakeDb([order("done"), ASSIGNED, [{ id: "l1" }], []]);
    await addWorkLine({ ...base, actor: staff, correction: grant }, { db: database });
    expect(log.values[1]).toEqual(audit("linea_trabajo", null, "l1"));
  });

  it("delete: writes `linea_trabajo` (id, null)", async () => {
    const { database, log } = fakeDb([order("cancelled"), LINE, [], []]);
    await deleteWorkLine({ ordenId: "o1", lineId: "l1", scope: SYSTEM_SCOPE, actor: staff, correction: grant }, { db: database });
    expect(log.values).toEqual([audit("linea_trabajo", "l1", null)]);
  });

  it("edit: one `linea_trabajo.<campo>` row per CHANGED field, id-prefixed, an unchanged one skipped", async () => {
    const { database, log } = fakeDb([order("done"), LINE, [], []]);
    await updateWorkLine(
      {
        ordenId: "o1",
        lineId: "l1",
        scope: SYSTEM_SCOPE,
        patch: { duracionMinutos: 45, descripcion: "Cambio de pastillas", fecha: "2026-10-06" },
        actor: staff,
        correction: grant,
      },
      { db: database },
    );
    expect(log.values).toEqual([
      [
        { ordenId: "o1", userId: "admin-1", field: "linea_trabajo.duracion_minutos", oldValue: "l1: 30", newValue: "l1: 45" },
        { ordenId: "o1", userId: "admin-1", field: "linea_trabajo.fecha", oldValue: "l1: 2026-10-05", newValue: "l1: 2026-10-06" },
      ],
    ]);
  });

  it("a failing audit insert rejects the whole call (the line change shares its transaction)", async () => {
    const { database } = fakeDb([order("done"), ASSIGNED, [{ id: "l1" }], new Error("audit down")]);
    await expect(addWorkLine({ ...base, actor: staff, correction: grant }, { db: database })).rejects.toThrow("audit down");
  });

  it("an open order writes no audit row even when a grant is passed", async () => {
    const { database, log } = fakeDb([order("in_progress"), ASSIGNED, [{ id: "l1" }]]);
    await addWorkLine({ ...base, actor: staff, correction: grant }, { db: database });
    expect(log.values).toHaveLength(1);
  });

  it("a jefe (never granted) is refused with OrderClosedError and nothing is written", async () => {
    const { database, log } = fakeDb([order("done")]);
    await expect(addWorkLine({ ...base, actor: { id: "jefe-1", canManageAll: true } }, { db: database })).rejects.toBeInstanceOf(
      OrderClosedError,
    );
    expect(log.values).toEqual([]);
  });

  it("the technician must still be assigned under correction: nothing is written, no audit", async () => {
    const { database, log } = fakeDb([order("done"), []]);
    await expect(addWorkLine({ ...base, actor: staff, correction: grant }, { db: database })).rejects.toBeInstanceOf(
      WorkLineValidationError,
    );
    expect(log.values).toEqual([]);
  });
});
