/**
 * customers/queries.ts — DB read model for `cliente` (R16, R18, R19).
 *
 * DI seam mirrors inventory-sync/job.ts's `hasActiveSyncRun`/`getLatestSyncRun`:
 * each exported read function takes an optional `queryFn` that fully replaces
 * the real DB call (defaulting to the actual drizzle query), so this module
 * is unit-testable with injected fakes and no live Postgres connection.
 */
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/shared/db/client";
import { cliente, ordenServicio, type Cliente, type OrdenServicio, type Vehiculo } from "@/shared/db/schema";
import { listVehiculosByCliente, platesSubquery, vehiculoPlateExists } from "./vehicles";

export const DEFAULT_PAGE_SIZE = 10;

export type ClienteFilters = {
  search?: string;
  /**
   * R20 — three states, not a boolean. `includeInactive` used to mean "active
   * or everything", which left "solo desactivados" unaskable: the screen
   * offered a checkbox that could not express it, and staff looking for a
   * customer they had deactivated had to scan the whole list.
   */
  status?: "active" | "inactive" | "all";
};

export type ClienteListItem = Pick<Cliente, "id" | "name" | "phone" | "email" | "deactivatedAt" | "createdAt"> & {
  /** R19/D4 — this customer's active vehicle plates. */
  plates: string[];
};

export type ClienteDetail = { cliente: Cliente; orders: OrdenServicio[]; vehicles: Vehiculo[] };

/**
 * `ilike` folds case but NOT accents, so 'María GONZÁLEZ' ilike '%maria%' is
 * false. Wrapping BOTH sides in `unaccent()` (extension enabled by migration
 * 0012) makes the fold symmetric: an unaccented term matches an accented row
 * and vice versa.
 *
 * `unaccent()` is STABLE, not IMMUTABLE, so it can never back an expression
 * index — see design.md's "Migration / Rollout". Correct at 364 rows; a
 * future `pg_trgm` upgrade must account for it.
 */
function unaccentIlike(column: PgColumn, pattern: string): SQL {
  return sql`unaccent(${column}) ilike unaccent(${pattern})`;
}

/**
 * Pure — R19's "partial, case- and accent-insensitive match against name,
 * phone, or any active vehicle plate". Migration `0014` (slice 3) dropped
 * `cliente.vehicle_plate`, so the plate path is the `vehiculo` EXISTS only.
 */
export function buildClienteSearchWhere(search?: string) {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  return or(
    unaccentIlike(cliente.name, pattern),
    unaccentIlike(cliente.phone, pattern),
    // D4 — `unaccentIlike` is reused verbatim (PR #44), applied to
    // `vehiculo.plate` inside `vehicles.ts`, which owns that table (D3).
    vehiculoPlateExists(pattern, unaccentIlike),
  );
}

/**
 * R20 (design D3) — the ONE place the default exclusion lives, and the reason
 * it is here rather than in each screen: `CustomerPicker` reads the same
 * `GET /api/customers` the list page does, so filtering here means no new
 * service order can name a deactivated customer without the picker changing
 * at all. Filtering per caller instead would leave every future caller of
 * `listClientes` to remember, and the third one will not.
 *
 * Deliberately NOT applied by `getClienteById`: you cannot reactivate a
 * record you cannot open, which is the same reason that function already
 * fetches inactive VEHICLES.
 *
 * The active filter sits OUTSIDE the search branch. Inside it, a bare list
 * with no search term — the screen staff actually open — would show every
 * deactivated row.
 */
export function buildClienteListWhere(filters: ClienteFilters): SQL | undefined {
  const search = buildClienteSearchWhere(filters.search);
  if (filters.status === "all") return search;
  // Outside the search branch, for the reason the docstring above gives.
  const state =
    filters.status === "inactive" ? isNotNull(cliente.deactivatedAt) : isNull(cliente.deactivatedAt);
  return search ? and(state, search) : state;
}

/**
 * table-column-sorting D2 — one whitelist, shared by `parseClienteSort` and
 * the page (which imports it to decide which headers link). `plates` is
 * included: the throwaway-Postgres spike (design's Open Question, task 1.2,
 * recorded in apply-progress) proved `.orderBy()` against this correlated
 * `array_agg` alias both executes and reads sensibly (alphabetical by first
 * plate).
 *
 * `name` and `email` are wrapped in `lower(unaccent(...))`. Task 1.1 read
 * `datcollate` off the Postgres on `:5432` and concluded no wrapping was
 * needed — but the app connects to `:5433` (see `.env`), a different
 * instance. That one also reports `en_US.utf8` and then orders by BYTES:
 *
 *   plain              Ana < Zapata < Zulema < automovil < Ángel
 *   lower()            Ana < automovil < Zapata < Zulema < Ángel
 *   lower(unaccent())  Ana < Ángel < automovil < Zapata < Zulema
 *
 * Measured on that instance with the app's own credentials. Unwrapped, every
 * lowercase name sorts after every uppercase one and "Ángel", "Núñez" and
 * "Peña" land past "Z" — this list already contains NUÑEZ and Peña.
 *
 * `phone` is left bare: digits and dashes have neither case nor accents.
 * `plates` too — plates are uppercase alphanumeric by construction.
 *
 * `unaccent()` is STABLE, so this cannot use `cliente_name_idx`; at 370 rows
 * that is a sequential scan of nothing. It would need a rethink at a scale
 * where the index mattered.
 */
export const CLIENTE_SORT = {
  name: sql`lower(unaccent(${cliente.name}))`,
  phone: cliente.phone,
  email: sql`lower(unaccent(${cliente.email}))`,
  plates: platesSubquery(),
} as const;

export type ClienteSort = { key: keyof typeof CLIENTE_SORT; dir: "asc" | "desc" };

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstSortValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Pure — whitelist + `asc|desc` check; a garbage `sort`/`dir` falls back to `undefined`. */
export function parseClienteSort(searchParams: RawSearchParams): ClienteSort | undefined {
  const key = firstSortValue(searchParams.sort);
  const dir = firstSortValue(searchParams.dir);
  if (!key || !(key in CLIENTE_SORT)) return undefined;
  if (dir !== "asc" && dir !== "desc") return undefined;
  return { key: key as keyof typeof CLIENTE_SORT, dir };
}

function buildClienteOrderBy(sort?: ClienteSort) {
  if (!sort) return desc(cliente.createdAt);
  const column = CLIENTE_SORT[sort.key];
  return sort.dir === "asc" ? asc(column) : desc(column);
}

/** R19 — paginated + searched customer list, newest first by default; sortable per D2. */
export async function listClientes(
  filters: ClienteFilters,
  window: { offset: number; limit: number },
  sort?: ClienteSort,
  queryFn: () => Promise<ClienteListItem[]> = () =>
    db
      .select({
        id: cliente.id,
        name: cliente.name,
        phone: cliente.phone,
        email: cliente.email,
        // Only ever non-null when the caller asked for a status that admits them — the
        // row needs it to mark itself, and R20 requires a listed deactivated
        // customer to be visibly deactivated rather than silently mixed in.
        deactivatedAt: cliente.deactivatedAt,
        plates: platesSubquery(),
        createdAt: cliente.createdAt,
      })
      .from(cliente)
      .where(buildClienteListWhere(filters))
      .orderBy(buildClienteOrderBy(sort))
      .limit(window.limit)
      .offset(window.offset),
): Promise<ClienteListItem[]> {
  return queryFn();
}

/** R19 — total count for the same filter, for pagination math. */
export async function countClientes(
  filters: ClienteFilters,
  queryFn: () => Promise<number> = async () => {
    const rows = await db.select({ value: count() }).from(cliente).where(buildClienteListWhere(filters));
    return rows[0]?.value ?? 0;
  },
): Promise<number> {
  return queryFn();
}

/** R16 — customer detail + its service-order history, most-recent first. */
export async function getClienteById(
  id: string,
  queryFn: () => Promise<ClienteDetail | null> = async () => {
    const rows = await db.select().from(cliente).where(eq(cliente.id, id)).limit(1);
    const clienteRow = rows[0];
    if (!clienteRow) return null;
    const orders = await db
      .select()
      .from(ordenServicio)
      .where(eq(ordenServicio.clienteId, id))
      .orderBy(desc(ordenServicio.createdAt));
    // R16/restore — the WHOLE collection, not just active vehicles: the
    // detail view renders an inactive vehicle as visibly secondary, and
    // `CustomerForm`'s restore action needs its id to reconcile against.
    const vehicles = await listVehiculosByCliente(id, { includeInactive: true });
    return { cliente: clienteRow, orders, vehicles };
  },
): Promise<ClienteDetail | null> {
  return queryFn();
}

/** R18 — duplicate-phone lookup; used by service.ts before create/update. */
export async function findClienteByPhone(
  phone: string,
  queryFn: () => Promise<Cliente[]> = () => db.select().from(cliente).where(eq(cliente.phone, phone)).limit(1),
): Promise<Cliente | null> {
  const rows = await queryFn();
  return rows[0] ?? null;
}
