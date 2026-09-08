import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio, Vehiculo } from "@/shared/db/schema";
import {
  buildClienteListWhere,
  buildClienteSearchWhere,
  CLIENTE_SORT,
  countClientes,
  findClienteByPhone,
  getClienteById,
  listClientes,
  parseClienteSort,
  type ClienteListItem,
} from "./queries";

/** Renders the built condition to real Postgres SQL + bound params, no connection needed. */
function compileSearchWhere(term: string) {
  const condition = buildClienteSearchWhere(term);
  expect(condition).toBeDefined();
  return new PgDialect().sqlToQuery(condition!);
}

/**
 * R20 (customer-deactivation D3) — the whole change is a `WHERE` clause, and
 * `vitest.config.ts` points DATABASE_URL at a nonexistent database, so these
 * compile the condition to real Postgres SQL rather than run it. The e2e suite
 * carries the rows that actually execute it.
 */
function compileListWhere(filters: Parameters<typeof buildClienteListWhere>[0]) {
  const condition = buildClienteListWhere(filters);
  return condition === undefined ? undefined : new PgDialect().sqlToQuery(condition);
}

/**
 * R20 gained a THIRD state. The filter used to be a boolean — active, or
 * everything — so "solo desactivados" had no way to be asked for, and the
 * screen offered a checkbox that could not express it.
 */
describe("buildClienteListWhere — the three states", () => {
  it("shows ONLY deactivated customers when asked for them", () => {
    const compiled = compileListWhere({ status: "inactive" });
    expect(compiled?.sql).toContain('"cliente"."deactivated_at" is not null');
    // Qualified, per the convention this file already set below: R19's plate
    // subquery carries its OWN `vehiculo.deactivated_at is null`, so a bare
    // match here goes red on the wrong table the moment a search term joins it.
    expect(compiled?.sql).not.toContain('"cliente"."deactivated_at" is null');
  });

  it("filters on neither when asked for all", () => {
    expect(compileListWhere({ status: "all" })).toBeUndefined();
  });

  // The state applies OUTSIDE the search branch, the same reason the original
  // active filter does: a bare list is the screen staff actually open.
  it("keeps the state alongside a search term, not instead of it", () => {
    const compiled = compileListWhere({ status: "inactive", search: "juan" });
    expect(compiled?.sql).toContain('"cliente"."deactivated_at" is not null');
    expect(compiled?.sql).toContain("unaccent");
  });
});

describe("buildClienteListWhere (R20 — deactivated customers are excluded by default)", () => {
  it("filters out deactivated customers even with NO search term", () => {
    // The failure this pins: an active-only filter written INSIDE the search
    // branch applies only when someone is searching, so the bare list — the
    // screen staff actually open — would still show every deactivated row.
    const compiled = compileListWhere({});
    expect(compiled).toBeDefined();
    expect(compiled!.sql).toContain('"cliente"."deactivated_at" is null');
  });

  it("keeps the search predicate AND the active filter when both apply", () => {
    const compiled = compileListWhere({ search: "juan" });
    expect(compiled!.sql).toContain('"cliente"."deactivated_at" is null');
    expect(compiled!.sql).toContain("unaccent");
    expect(compiled!.params).toContain("%juan%");
  });

  it("drops the CUSTOMER active filter when the operator asks for every record", () => {
    const compiled = compileListWhere({ search: "juan", status: "all" });
    // Qualified, not a bare "deactivated_at": R19's plate subquery carries its
    // OWN `vehiculo.deactivated_at is null`, and the first version of this
    // test failed on that. The two soft deletes are independent concepts and
    // must stay so — asking to see a retired CUSTOMER is not asking to search
    // the plates of cars they no longer own.
    expect(compiled!.sql).not.toContain('"cliente"."deactivated_at"');
    expect(compiled!.sql).toContain('"vehiculo"."deactivated_at" is null');
  });

  it("leaves R19's active-PLATE predicate alone when excluding deactivated customers", () => {
    const compiled = compileListWhere({ search: "juan" });
    expect(compiled!.sql).toContain('"vehiculo"."deactivated_at" is null');
  });

  it("returns undefined for no term AND status=all — nothing left to filter on", () => {
    expect(compileListWhere({ status: "all" })).toBeUndefined();
  });
});

describe("buildClienteSearchWhere (R19)", () => {
  it("returns undefined when no search term is given", () => {
    expect(buildClienteSearchWhere(undefined)).toBeUndefined();
  });

  it("returns undefined for a blank/whitespace-only search term", () => {
    expect(buildClienteSearchWhere("   ")).toBeUndefined();
  });

  it("returns a defined condition when a search term is given (matches name/phone/plate)", () => {
    expect(buildClienteSearchWhere("juan")).toBeDefined();
  });

  it("folds accents as well as case, so an unaccented term matches an accented row", () => {
    // Postgres `ilike` folds case but NOT accents: 'María GONZÁLEZ' ilike
    // '%maria%' is false. The customer dataset is Spanish, so staff typing
    // "maria gonza" would otherwise get zero matches and be offered "create
    // customer" — the duplicate this whole change exists to prevent. Both
    // sides go through `unaccent()` (migration 0012) so the fold is symmetric:
    // an unaccented term matches an accented row and vice versa.
    const { sql, params } = compileSearchWhere("maria gonza");
    expect(sql).toContain(`unaccent("cliente"."name") ilike unaccent($1)`);
    expect(sql).toContain(`unaccent("cliente"."phone") ilike unaccent($2)`);
    // Three: name, phone, and the EXISTS over vehiculo.plate. Migration 0014
    // (slice 3) dropped `cliente.vehicle_plate`, so the flat branch this used
    // to have alongside the EXISTS is gone — only one plate path remains.
    expect(params).toEqual(["%maria gonza%", "%maria gonza%", "%maria gonza%"]);
  });

  it("evaluates the plate branch as an EXISTS over vehiculo, active vehicles only (D3/D4)", () => {
    // The failure mode this test exists to catch: dropping the
    // `deactivated_at is null` clause would silently resurface a
    // soft-deleted vehicle's plate in search results with no other signal.
    const { sql } = compileSearchWhere("abc");
    expect(sql).toContain(
      `exists (select 1 from "vehiculo" where "vehiculo"."cliente_id" = "cliente"."id"`,
    );
    expect(sql).toContain(`"vehiculo"."deactivated_at" is null`);
    expect(sql).toContain(`unaccent("vehiculo"."plate") ilike unaccent($3)`);
  });
});

/**
 * table-column-sorting WU1 — `plates` is in the whitelist because the
 * throwaway-Postgres spike (task 1.2, recorded in apply-progress) proved both
 * required conditions: `.orderBy()` against the correlated `platesSubquery()`
 * alias executes, and the resulting array-lexicographic order reads
 * sensibly (alphabetical by first plate). Had either failed, this key would
 * not exist (design D2 — "dropping plates is deleting one key").
 */
/**
 * Measured against the database the app actually uses (`:5433`, 370 rows), not
 * the one on `:5432` that task 1.1 probed by mistake. It reports
 * `datcollate = en_US.utf8` and then orders by BYTES:
 *
 *   plain             Ana < Zapata < Zulema < automovil < Ángel
 *   lower()           Ana < automovil < Zapata < Zulema < Ángel
 *   lower(unaccent()) Ana < Ángel < automovil < Zapata < Zulema   ← correct
 *
 * So every lowercase name lands after every uppercase one, and "Ángel",
 * "Núñez" and "Peña" land after "Z" — in a Spanish app whose own customer
 * list contains NUÑEZ and Peña. `unaccent()` is STABLE, which blocks an
 * expression index but not an ORDER BY; at 370 rows the unused
 * `cliente_name_idx` costs nothing.
 */
describe("CLIENTE_SORT text ordering", () => {
  const dialect = new PgDialect();

  it.each(["name", "email"] as const)(
    "orders %s case- and accent-insensitively, not by byte",
    (key) => {
      const rendered = dialect.sqlToQuery(sql`${CLIENTE_SORT[key]}`).sql;
      expect(rendered).toContain("lower(unaccent(");
    },
  );

  it("leaves phone alone — digits have neither case nor accents", () => {
    const rendered = dialect.sqlToQuery(sql`${CLIENTE_SORT.phone}`).sql;
    expect(rendered).not.toContain("lower(");
  });
});

describe("parseClienteSort", () => {
  it.each(["name", "phone", "email", "plates"] as const)(
    "returns a defined sort for the whitelisted column %s",
    (key) => {
      expect(parseClienteSort({ sort: key, dir: "asc" })).toEqual({ key, dir: "asc" });
      expect(parseClienteSort({ sort: key, dir: "desc" })).toEqual({ key, dir: "desc" });
    },
  );

  it("returns undefined for a column not on the whitelist", () => {
    expect(parseClienteSort({ sort: "createdAt", dir: "asc" })).toBeUndefined();
  });

  it("returns undefined for a dir outside asc|desc", () => {
    expect(parseClienteSort({ sort: "name", dir: "sideways" })).toBeUndefined();
  });

  it("returns undefined when no sort param is present", () => {
    expect(parseClienteSort({})).toBeUndefined();
    expect(parseClienteSort({ dir: "asc" })).toBeUndefined();
  });

  it("CLIENTE_SORT whitelists exactly name, phone, email, plates", () => {
    expect(Object.keys(CLIENTE_SORT).sort()).toEqual(["email", "name", "phone", "plates"]);
  });
});

describe("listClientes (R19)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows: ClienteListItem[] = [
      {
        id: "c1",
        name: "Juan",
        phone: "+525512345678",
        email: null,
        deactivatedAt: null,
        plates: [],
        createdAt: new Date(),
      },
    ];
    await expect(
      listClientes({ search: "juan" }, { offset: 0, limit: 10 }, undefined, async () => rows),
    ).resolves.toEqual(rows);
  });
});

describe("countClientes (R19)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    await expect(countClientes({}, async () => 5)).resolves.toBe(5);
  });
});

describe("getClienteById (R16)", () => {
  it("returns null when the injected queryFn finds nothing", async () => {
    await expect(getClienteById("missing", async () => null)).resolves.toBeNull();
  });

  it("returns the cliente + its service-order history (most-recent first is the queryFn's contract)", async () => {
    const detail = {
      cliente: { id: "c1", name: "Juan" } as unknown as Cliente,
      orders: [{ id: "o2" }, { id: "o1" }] as unknown as OrdenServicio[],
      vehicles: [] as Vehiculo[],
    };
    await expect(getClienteById("c1", async () => detail)).resolves.toEqual(detail);
  });
});

describe("findClienteByPhone (R18)", () => {
  it("returns null when no row matches", async () => {
    await expect(findClienteByPhone("+525512345678", async () => [])).resolves.toBeNull();
  });

  it("returns the matching row when found", async () => {
    const row = { id: "c1", phone: "+525512345678" } as unknown as Cliente;
    await expect(findClienteByPhone("+525512345678", async () => [row])).resolves.toEqual(row);
  });
});
