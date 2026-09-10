import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  INVENTORY_SORT,
  buildInventoryOrderBy,
  buildWhere,
  computePageWindow,
  listInventory,
  normalizeFilters,
  parseInventorySort,
  type InventoryListItem,
} from "./queries";

describe("normalizeFilters", () => {
  it("returns no filters when searchParams has neither category key", () => {
    expect(normalizeFilters({})).toEqual({});
  });

  it("picks categoryL1 only when only L1 is present", () => {
    expect(normalizeFilters({ categoryL1: "Motor" })).toEqual({ categoryL1: "Motor" });
  });

  it("combines categoryL1 and categoryL2 when both are present", () => {
    expect(normalizeFilters({ categoryL1: "Motor", categoryL2: "Frenos" })).toEqual({
      categoryL1: "Motor",
      categoryL2: "Frenos",
    });
  });

  it("drops empty-string values (treated as cleared filters, R3.5)", () => {
    expect(normalizeFilters({ categoryL1: "", categoryL2: "Frenos" })).toEqual({ categoryL2: "Frenos" });
  });

  it("takes the first value when Next.js gives an array (repeated query key)", () => {
    expect(normalizeFilters({ categoryL1: ["Motor", "Suspension"] })).toEqual({ categoryL1: "Motor" });
  });

  it("parses in-stock stockStatus", () => {
    expect(normalizeFilters({ stockStatus: "in-stock" })).toEqual({ stockStatus: "in-stock" });
  });

  it("parses out-of-stock stockStatus", () => {
    expect(normalizeFilters({ stockStatus: "out-of-stock" })).toEqual({ stockStatus: "out-of-stock" });
  });

  it("rejects invalid stockStatus values", () => {
    expect(normalizeFilters({ stockStatus: "maybe" })).toEqual({});
  });
});

describe("computePageWindow", () => {
  it("defaults to page 1 / offset 0 when the page param is missing", () => {
    expect(computePageWindow(undefined)).toEqual({ page: 1, offset: 0, limit: DEFAULT_PAGE_SIZE });
  });

  it("computes the offset for page 3 at the default page size", () => {
    expect(computePageWindow("3")).toEqual({ page: 3, offset: 2 * DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE });
  });

  it("clamps non-numeric page params back to page 1", () => {
    expect(computePageWindow("abc")).toEqual({ page: 1, offset: 0, limit: DEFAULT_PAGE_SIZE });
  });

  it("clamps zero and negative page params back to page 1", () => {
    expect(computePageWindow("0")).toEqual({ page: 1, offset: 0, limit: DEFAULT_PAGE_SIZE });
    expect(computePageWindow("-5")).toEqual({ page: 1, offset: 0, limit: DEFAULT_PAGE_SIZE });
  });

  it("floors fractional page params", () => {
    expect(computePageWindow("2.9")).toEqual({ page: 2, offset: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE });
  });

  it("respects a custom page size", () => {
    expect(computePageWindow("2", 10)).toEqual({ page: 2, offset: 10, limit: 10 });
  });
});

/**
 * table-column-sorting WU2 — the rendered headers only: `id`/`name`/
 * `categoryL1`/`categoryL2` (`inventory/page.tsx:118-121`). `stock`/`price`
 * are fetched and filterable but have no header, so they stay off the
 * whitelist even though they are on `InventoryListItem`.
 */
describe("parseInventorySort", () => {
  it.each(["id", "name", "categoryL1", "categoryL2"] as const)(
    "returns a defined sort for the whitelisted column %s",
    (key) => {
      expect(parseInventorySort({ sort: key, dir: "asc" })).toEqual({ key, dir: "asc" });
      expect(parseInventorySort({ sort: key, dir: "desc" })).toEqual({ key, dir: "desc" });
    },
  );

  it.each(["stock", "price"] as const)(
    "rejects %s — fetched but not rendered as a header, so not sortable",
    (key) => {
      expect(parseInventorySort({ sort: key, dir: "asc" })).toBeUndefined();
    },
  );

  /**
   * `Object.hasOwn`, NOT `key in INVENTORY_SORT` — WU1's finding
   * (`customers/queries.ts` `parseClienteSort`). `in` walks the prototype
   * chain, so these names would otherwise pass the whitelist silently: the
   * ORDER BY collapses to the tiebreaker while the URL keeps advertising a
   * sort that never runs.
   */
  it.each(["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"])(
    "rejects the inherited property %s, which `in` would have accepted",
    (key) => {
      expect(parseInventorySort({ sort: key, dir: "asc" })).toBeUndefined();
    },
  );

  it("returns undefined for a column not on the whitelist", () => {
    expect(parseInventorySort({ sort: "createdAt", dir: "asc" })).toBeUndefined();
  });

  it("returns undefined for a dir outside asc|desc", () => {
    expect(parseInventorySort({ sort: "name", dir: "sideways" })).toBeUndefined();
  });

  it("returns undefined when no sort param is present", () => {
    expect(parseInventorySort({})).toBeUndefined();
    expect(parseInventorySort({ dir: "asc" })).toBeUndefined();
  });

  it("INVENTORY_SORT whitelists exactly id, name, categoryL1, categoryL2", () => {
    expect(Object.keys(INVENTORY_SORT).sort()).toEqual(["categoryL1", "categoryL2", "id", "name"]);
  });
});

/**
 * Measured against the app's own database (`:5433`, 699 products): `name`
 * has mixed case and accented characters (20 rows with lowercase, e.g.
 * "ACEITE ... FULL SINTÉTICO", "Correa honda CRV 06-11 (única) BANDO"), so a
 * plain `ORDER BY` sorts by byte value exactly like WU1's `cliente.name`
 * finding — every lowercase name after every uppercase one, accents past Z.
 * `categoryL1`/`categoryL2` are a small fixed vocabulary synced from
 * Interfuerza (9 and 12 distinct values respectively), all uppercase ASCII
 * with no diacritics — verified by querying every distinct value — so they
 * are left bare, like WU1 left `phone` bare.
 */
describe("INVENTORY_SORT text ordering", () => {
  const dialect = new PgDialect();

  it("wraps name in lower(unaccent(...)) — mixed case and accents measured in real data", () => {
    const rendered = dialect.sqlToQuery(sql`${INVENTORY_SORT.name}`).sql;
    expect(rendered).toContain("lower(unaccent(");
  });

  it.each(["categoryL1", "categoryL2"] as const)(
    "leaves %s bare — a fixed uppercase, unaccented vocabulary, verified against real data",
    (key) => {
      const rendered = dialect.sqlToQuery(sql`${INVENTORY_SORT[key]}`).sql;
      expect(rendered).not.toContain("lower(");
    },
  );

  it("leaves id bare — a fixed-format code (e.g. PS0000001), no case or accents", () => {
    const rendered = dialect.sqlToQuery(sql`${INVENTORY_SORT.id}`).sql;
    expect(rendered).not.toContain("lower(");
  });
});

/**
 * `categoryL1`/`categoryL2` render a column EXPRESSION; this renders the
 * finished ORDER BY clause. WU1's `buildClienteOrderBy` comment: putting
 * "nulls last" inside the expression produces "… nulls last desc", which
 * Postgres rejects — direction first, then NULLS.
 */
describe("buildInventoryOrderBy renders valid SQL", () => {
  const dialect = new PgDialect();

  it.each([
    ["asc", "asc nulls last"],
    ["desc", "desc nulls last"],
  ] as const)("puts the direction before NULLS for %s", (dir, expected) => {
    const [primary] = buildInventoryOrderBy({ key: "categoryL2", dir });
    expect(dialect.sqlToQuery(sql`${primary}`).sql).toContain(expected);
  });

  /**
   * `producto.id` is the actual PRIMARY KEY, not merely near-unique like
   * WU1's `createdAt` tiebreaker — it can never tie, so paging can never
   * repeat or skip a row regardless of which column is the primary sort.
   */
  it("always appends a stable tiebreaker, so paging cannot repeat or skip a row", () => {
    expect(buildInventoryOrderBy({ key: "name", dir: "asc" })).toHaveLength(2);
    expect(buildInventoryOrderBy(undefined)).toHaveLength(2);
  });

  /**
   * The landing page and a click on "Name ascending" must be the SAME order.
   * The bare `asc(producto.name)` this function replaced sorted by byte value
   * while the header sorted by `lower(unaccent(...))`; measured on the app's
   * own database those two disagree on essentially every one of the 699 rows,
   * so the table visibly reshuffled when the user clicked the column it was
   * already sorted by.
   */
  it("defaults to the same expression a click on Name ascending produces", () => {
    const [byDefault] = buildInventoryOrderBy(undefined);
    const [byClick] = buildInventoryOrderBy({ key: "name", dir: "asc" });
    expect(dialect.sqlToQuery(sql`${byDefault}`).sql).toBe(dialect.sqlToQuery(sql`${byClick}`).sql);
  });
});

describe("listInventory", () => {
  it("returns whatever the injected queryFn resolves", async () => {
    const result: { items: InventoryListItem[]; total: number } = {
      items: [{ id: "PS1", name: "Filtro", categoryL1: "REPUESTOS", categoryL2: null, price: 10, stock: 2 }],
      total: 1,
    };
    await expect(
      listInventory({}, { offset: 0, limit: 10 }, undefined, async () => result),
    ).resolves.toEqual(result);
  });
});

/**
 * `/customers` has folded accents on both sides since PR #44; this screen
 * never did. Searching `bateria` missed every `batería` in a catalogue an ERP
 * writes accented — a real miss on 699 rows, not a nicety.
 *
 * The rendered SQL is the assertion, because the fold IS the `WHERE`: an
 * injected seam would let a green suite prove nothing about it.
 */
describe("buildWhere — the inventory name search folds accents", () => {
  const dialect = new PgDialect();

  it("wraps BOTH sides in unaccent, so an unaccented term finds an accented row", () => {
    const where = buildWhere({ name: "bateria" });

    const rendered = dialect.sqlToQuery(sql`${where}`).sql;

    // Both sides: folding only the column leaves the fold one-directional.
    expect(rendered).toContain("unaccent");
    expect(rendered.match(/unaccent/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // The product `id` is an ERP code with no accents to fold, and leaving it as
  // a plain `ilike` keeps it index-eligible. Stated so nobody "completes" it.
  it("leaves the id search as a plain ilike", () => {
    const where = buildWhere({ id: "PH10060" });

    expect(dialect.sqlToQuery(sql`${where}`).sql).not.toContain("unaccent");
  });
});
