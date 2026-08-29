import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { Cliente, OrdenServicio, Vehiculo } from "@/shared/db/schema";
import {
  buildClienteSearchWhere,
  countClientes,
  findClienteByPhone,
  getClienteById,
  listClientes,
  type ClienteListItem,
} from "./queries";

/** Renders the built condition to real Postgres SQL + bound params, no connection needed. */
function compileSearchWhere(term: string) {
  const condition = buildClienteSearchWhere(term);
  expect(condition).toBeDefined();
  return new PgDialect().sqlToQuery(condition!);
}

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

describe("listClientes (R19)", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const rows: ClienteListItem[] = [
      {
        id: "c1",
        name: "Juan",
        phone: "+525512345678",
        email: null,
        vehiclePlate: null,
        plates: [],
        createdAt: new Date(),
      },
    ];
    await expect(
      listClientes({ search: "juan" }, { offset: 0, limit: 10 }, async () => rows),
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
