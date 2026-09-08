import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { OrdenServicio, OrdenServicioItem } from "@/shared/db/schema";
import {
  buildOrdenServicioOrderBy,
  buildOrdenServicioWhere,
  countOrdenesServicio,
  getOrdenServicioById,
  listOrdenesByVehiculo,
  listOrdenesServicio,
  ORDEN_SORT,
  parseOrdenSort,
} from "./queries";

describe("buildOrdenServicioWhere (R21)", () => {
  it("returns undefined when no status filter is given", () => {
    expect(buildOrdenServicioWhere({})).toBeUndefined();
  });

  it("returns a defined condition when a status filter is given", () => {
    expect(buildOrdenServicioWhere({ status: "open" })).toBeDefined();
  });
});

describe("listOrdenesServicio (R21)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [{ id: "o1", status: "open" }] as unknown as OrdenServicio[];
    await expect(
      // `sort` moved to the 3rd positional slot (table-column-sorting WU3) —
      // `undefined` here reproduces today's default order.
      listOrdenesServicio({ status: "open" }, { offset: 0, limit: 10 }, undefined, async () => rows),
    ).resolves.toEqual(rows);
  });

  it("hands the sort through to the injected queryFn's caller unaffected — the seam does not care about sort shape", async () => {
    const rows = [{ id: "o1", status: "open" }] as unknown as OrdenServicio[];
    await expect(
      listOrdenesServicio(
        { status: "open" },
        { offset: 0, limit: 10 },
        { key: "status", dir: "asc" },
        async () => rows,
      ),
    ).resolves.toEqual(rows);
  });
});

/**
 * table-column-sorting WU3. `id`/`status`/`appointmentAt` are sortable;
 * `description` is unindexed free text with no user-meaningful order and is
 * deliberately absent from the whitelist.
 */
describe("parseOrdenSort", () => {
  it.each(["id", "status", "appointmentAt"] as const)(
    "returns a defined sort for the whitelisted column %s",
    (key) => {
      expect(parseOrdenSort({ sort: key, dir: "asc" })).toEqual({ key, dir: "asc" });
      expect(parseOrdenSort({ sort: key, dir: "desc" })).toEqual({ key, dir: "desc" });
    },
  );

  /**
   * `key in ORDEN_SORT` walks the PROTOTYPE CHAIN, so `toString`,
   * `constructor`, `valueOf` and `__proto__` would all pass the whitelist
   * silently — `CLIENTE_SORT["toString"]` renders as a bound `$1` and the
   * ORDER BY collapses to the tiebreaker while the URL keeps advertising the
   * sort. `Object.hasOwn` closes that; `?sort=garbage` alone would not have
   * caught it.
   */
  it.each(["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"])(
    "rejects the inherited property %s, which `in` would have accepted",
    (key) => {
      expect(parseOrdenSort({ sort: key, dir: "asc" })).toBeUndefined();
    },
  );

  it("returns undefined for description — unindexed free text, no user-meaningful order", () => {
    expect(parseOrdenSort({ sort: "description", dir: "asc" })).toBeUndefined();
  });

  it("returns undefined for a dir outside asc|desc", () => {
    expect(parseOrdenSort({ sort: "status", dir: "sideways" })).toBeUndefined();
  });

  it("returns undefined when no sort param is present", () => {
    expect(parseOrdenSort({})).toBeUndefined();
    expect(parseOrdenSort({ dir: "asc" })).toBeUndefined();
  });

  it("ORDEN_SORT whitelists exactly id, status, appointmentAt — description is deliberately absent", () => {
    expect(Object.keys(ORDEN_SORT).sort()).toEqual(["appointmentAt", "id", "status"]);
  });
});

/**
 * `ORDEN_SORT` renders a column EXPRESSION; this renders the finished ORDER
 * BY clause. `appointmentAt` is the one nullable column here (spec's NULL
 * Ordering requirement), and it must sort last in BOTH directions — Postgres
 * defaults to NULLS FIRST on DESC, so a naive `desc()` would open the sort on
 * a page of every order with no appointment at all.
 */
describe("buildOrdenServicioOrderBy renders valid SQL", () => {
  const dialect = new PgDialect();

  it.each([
    ["asc", "asc nulls last"],
    ["desc", "desc nulls last"],
  ] as const)("puts the direction before NULLS for %s", (dir, expected) => {
    const [primary] = buildOrdenServicioOrderBy({ key: "appointmentAt", dir });
    expect(dialect.sqlToQuery(sql`${primary}`).sql).toContain(expected);
  });

  it("always appends a stable tiebreaker, so paging cannot repeat or skip a row", () => {
    // `status` has only four values — the case the tiebreaker exists for.
    expect(buildOrdenServicioOrderBy({ key: "status", dir: "asc" })).toHaveLength(2);
    expect(buildOrdenServicioOrderBy(undefined)).toHaveLength(1);
  });
});

describe("countOrdenesServicio (R21)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    await expect(countOrdenesServicio({}, async () => 7)).resolves.toBe(7);
  });
});

describe("listOrdenesByVehiculo (C4)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [{ id: "o1", vehiculoId: "v1" }] as unknown as OrdenServicio[];
    await expect(listOrdenesByVehiculo("v1", async () => rows)).resolves.toEqual(rows);
  });
});

describe("getOrdenServicioById (R20)", () => {
  it("returns null when the injected queryFn finds nothing", async () => {
    await expect(getOrdenServicioById("missing", async () => null)).resolves.toBeNull();
  });

  it("returns the order + its line items when found", async () => {
    const detail = {
      orden: { id: "o1", status: "open" } as unknown as OrdenServicio,
      items: [
        { id: "i1", ordenId: "o1", productName: "Filtro de aceite", quantity: 2 },
      ] as unknown as OrdenServicioItem[],
    };
    await expect(getOrdenServicioById("o1", async () => detail)).resolves.toEqual(detail);
  });
});
