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
  ordenServicioCountQuery,
  ordenServicioListQuery,
  ORDEN_SORT,
  parseOrdenSort,
  type OrdenServicioListItem,
} from "./queries";

/** Renders the built condition to real Postgres SQL + bound params, no connection needed. */
function compileWhere(filters: Parameters<typeof buildOrdenServicioWhere>[0]) {
  const condition = buildOrdenServicioWhere(filters);
  return condition === undefined ? undefined : new PgDialect().sqlToQuery(condition);
}

describe("buildOrdenServicioWhere (R21)", () => {
  it("returns undefined when no status filter is given", () => {
    expect(buildOrdenServicioWhere({})).toBeUndefined();
  });

  it("returns a defined condition when a status filter is given", () => {
    expect(buildOrdenServicioWhere({ status: "open" })).toBeDefined();
  });
});

/**
 * D7/D9 — the order search joins `cliente` and `vehiculo` directly and
 * matches the plate as a PLAIN column comparison, never
 * `vehiculoPlateExists` (which correlates on the CUSTOMER and filters to
 * active vehicles only — both wrong for an order that names exactly one
 * vehicle, possibly deactivated afterwards). This is the SQL-text proof: it
 * cannot prove Postgres accepts it, only that the rendered clause never
 * contains the two shapes D7 forbids.
 */
describe("buildOrdenServicioWhere — search (D7)", () => {
  it("ORs unaccent-ilike over cliente.name, cliente.phone and vehiculo.plate", () => {
    const compiled = compileWhere({ search: "perez" });
    expect(compiled).toBeDefined();
    expect((compiled!.sql.match(/unaccent\(/g) ?? []).length).toBe(6);
    expect((compiled!.sql.match(/ilike/g) ?? []).length).toBe(3);
    expect(compiled!.sql).toContain('"cliente"."name"');
    expect(compiled!.sql).toContain('"cliente"."phone"');
    expect(compiled!.sql).toContain('"vehiculo"."plate"');
    expect(compiled!.params).toContain("%perez%");
  });

  it("never carries a deactivated_at filter on either table — an order for a deactivated customer or vehicle is still a real order", () => {
    const compiled = compileWhere({ search: "perez" });
    expect(compiled!.sql).not.toContain("deactivated_at");
  });

  it("never correlates through an EXISTS subquery — the vehicle is joined one-to-one on this list", () => {
    const compiled = compileWhere({ search: "perez" });
    expect(compiled!.sql).not.toContain('exists (select 1 from "vehiculo"');
  });

  it("ands the search predicate with the status filter when both are given", () => {
    const compiled = compileWhere({ search: "perez", status: "open" });
    expect(compiled!.sql).toContain("unaccent");
    expect(compiled!.sql).toContain('"orden_servicio"."status"');
  });

  it("returns undefined for a blank/whitespace-only search term", () => {
    expect(buildOrdenServicioWhere({ search: "   " })).toBeUndefined();
  });
});

/**
 * D7/D9 — `listOrdenesServicio`'s default `queryFn` joins `cliente` and
 * `vehiculo` so the search predicate above has something to filter against.
 * `ordenServicioListQuery`/`ordenServicioCountQuery` are exposed for
 * `.toSQL()` the same way `catalog-builder/queries.ts`'s
 * `productsInCategoriesQuery` is — never executed, only compiled.
 */
describe("ordenServicioListQuery — joins (D7/D9)", () => {
  it("inner joins cliente and vehiculo on the order's own FKs", () => {
    const rendered = ordenServicioListQuery({}, { offset: 0, limit: 10 }).toSQL();
    expect(rendered.sql).toContain('inner join "cliente"');
    expect(rendered.sql).toContain('inner join "vehiculo"');
    expect(rendered.sql).toContain('"orden_servicio"."cliente_id" = "cliente"."id"');
    expect(rendered.sql).toContain('"orden_servicio"."vehiculo_id" = "vehiculo"."id"');
  });

  /** D9's count-parity trap: missed here, the list filters and the pager does not. */
  it("countOrdenesServicio's query carries the identical two joins", () => {
    const rendered = ordenServicioCountQuery({}).toSQL();
    expect(rendered.sql).toContain('inner join "cliente"');
    expect(rendered.sql).toContain('inner join "vehiculo"');
  });

  /**
   * Task 2.17 — the design's own unverified claim, checked rather than
   * assumed. All three joined tables have their own `id` column; every
   * identifier this query renders must be table-qualified or Postgres (and a
   * future reader) cannot tell which `id` is meant.
   */
  it("qualifies every identifier — no bare column with three tables in scope", () => {
    const rendered = ordenServicioListQuery({ search: "perez", status: "open" }, { offset: 0, limit: 10 }, { key: "id", dir: "asc" }).toSQL();
    expect(rendered.sql).not.toMatch(/[^."]"id"/);
    expect(rendered.sql).toContain('"orden_servicio"."id"');
    expect(rendered.sql).toContain('"cliente"."id"');
    expect(rendered.sql).toContain('"vehiculo"."id"');
  });
});

/** D9 — the narrowed shape `ordenServicioListQuery`'s `.select({...})` returns. */
function ordenServicioListItem(overrides: Partial<OrdenServicioListItem> = {}): OrdenServicioListItem {
  return {
    id: "o1",
    status: "open",
    appointmentAt: null,
    clienteName: "Pérez",
    vehiculoPlate: "AB1234",
    vehiculoMake: "Toyota",
    vehiculoModel: "Hilux",
    ...overrides,
  };
}

describe("listOrdenesServicio (R21)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows = [ordenServicioListItem()];
    await expect(
      // `sort` moved to the 3rd positional slot (table-column-sorting WU3) —
      // `undefined` here reproduces today's default order.
      listOrdenesServicio({ status: "open" }, { offset: 0, limit: 10 }, undefined, async () => rows),
    ).resolves.toEqual(rows);
  });

  it("hands the sort through to the injected queryFn's caller unaffected — the seam does not care about sort shape", async () => {
    const rows = [ordenServicioListItem()];
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
    // D10 — the unsorted default is now TWO expressions too: `appointmentAt
    // desc nulls last` primary, `createdAt desc` tiebreak. This was a
    // COMMITTED RED (length 1) before D10's change landed — confirmed
    // failing by name in apply-progress, not silently rewritten.
    expect(buildOrdenServicioOrderBy(undefined)).toHaveLength(2);
  });

  /**
   * D10 — distinct from the explicit-sort case above: the UNSORTED default's
   * primary expression must itself be `appointmentAt desc nulls last`, not
   * merely two expressions of unspecified content.
   */
  it("the unsorted default's primary expression is appointmentAt desc nulls last", () => {
    const [primary] = buildOrdenServicioOrderBy(undefined);
    expect(dialect.sqlToQuery(sql`${primary}`).sql).toContain("desc nulls last");
    expect(dialect.sqlToQuery(sql`${primary}`).sql).toContain('"orden_servicio"."appointment_at"');
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
