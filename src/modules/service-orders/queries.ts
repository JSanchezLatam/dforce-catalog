/**
 * service-orders/queries.ts — DB read model for `orden_servicio` (R20, R21).
 *
 * DI seam mirrors customers/queries.ts / inventory-sync/job.ts's queryFn
 * pattern: each exported read function takes an optional `queryFn` that
 * fully replaces the real DB call (defaulting to the actual drizzle query),
 * so this module is unit-testable with injected fakes and no live Postgres
 * connection.
 */
import { count, desc, eq, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenServicio, ordenServicioItem, type OrdenServicio, type OrdenServicioItem } from "@/shared/db/schema";
import type { OrderStatus } from "./transitions";

export const DEFAULT_PAGE_SIZE = 10;

export type OrdenServicioFilters = { status?: OrderStatus };

export type OrdenServicioDetail = { orden: OrdenServicio; items: OrdenServicioItem[] };

/** Pure — R21's status-filter predicate for the list/count queries. */
export function buildOrdenServicioWhere(filters: OrdenServicioFilters) {
  return filters.status ? eq(ordenServicio.status, filters.status) : undefined;
}

/**
 * The sortable-column whitelist (table-column-sorting D2 — one object,
 * imported by both the query and the page, so neither can claim a column the
 * other does not support).
 *
 * `description` is deliberately NOT here: unindexed free text whose
 * alphabetical order carries no user meaning (spec's Per-Table Sortable
 * Column Whitelist).
 *
 * Neither `id` nor `status` needs `lower(unaccent(...))` — `id` is a UUID and
 * `status` is a small fixed enum, neither has case or accents to normalize
 * (customers/queries.ts's `CLIENTE_SORT` wraps `name`/`email` for exactly
 * that reason; it does not apply here).
 *
 * `status` is a Postgres ENUM (`order_status`), so Postgres orders it by
 * DECLARATION order, not alphabetically: asc is open -> in_progress -> done
 * -> cancelled. That is the order the workshop reads the board in, so it is
 * the better behaviour — but it is not what "sort by Estado" looks like from
 * the outside, and changing the enum's declaration order would silently
 * change this column's sort. Verified against a seeded database, not inferred.
 */
export const ORDEN_SORT = {
  id: ordenServicio.id,
  status: ordenServicio.status,
  appointmentAt: ordenServicio.appointmentAt,
} as const;

export type OrdenSort = { key: keyof typeof ORDEN_SORT; dir: "asc" | "desc" };

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstSortValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Pure — whitelist + `asc|desc` check; anything else falls back to `undefined`.
 *
 * `Object.hasOwn`, NOT `key in ORDEN_SORT` — `in` walks the prototype chain,
 * so `toString`, `constructor`, `valueOf` and `__proto__` would all pass the
 * whitelist silently (customers/queries.ts's `parseClienteSort` documents the
 * failure mode this avoids). D3 has every `parse*Sort` copy this shape rather
 * than share one hook.
 */
export function parseOrdenSort(searchParams: RawSearchParams): OrdenSort | undefined {
  const key = firstSortValue(searchParams.sort);
  const dir = firstSortValue(searchParams.dir);
  if (!key || !Object.hasOwn(ORDEN_SORT, key)) return undefined;
  if (dir !== "asc" && dir !== "desc") return undefined;
  return { key: key as keyof typeof ORDEN_SORT, dir };
}

/**
 * Always TWO order expressions — `status` has only four values, so a single
 * non-unique key would make paging unstable (Postgres gives no ordering
 * guarantee among ties; a row can appear on two pages and another on none).
 * `createdAt` is near-unique and is today's own default order, so it is the
 * tiebreaker unconditionally.
 *
 * `NULLS LAST` in BOTH directions, built HERE rather than inside `ORDEN_SORT`:
 * Drizzle's `asc()`/`desc()` append the direction AFTER the expression, so
 * putting "nulls last" inside the whitelist entry renders the invalid
 * `… nulls last desc` (customers/queries.ts's `buildClienteOrderBy` hit this
 * at runtime while its tests stayed green). `appointmentAt` is the only
 * nullable column here and the spec requires a missing appointment to never
 * be more prominent than a real one, in either direction — applying `nulls
 * last` to all three columns uniformly is a no-op on the two that are
 * `NOT NULL`.
 */
export function buildOrdenServicioOrderBy(sort?: OrdenSort) {
  const tiebreak = desc(ordenServicio.createdAt);
  if (!sort) return [tiebreak];
  const column = ORDEN_SORT[sort.key];
  const primary = sort.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  return [primary, tiebreak];
}

/** R21 — paginated + status-filtered service-order list, newest first by default; sortable per D2. */
export async function listOrdenesServicio(
  filters: OrdenServicioFilters,
  window: { offset: number; limit: number },
  sort?: OrdenSort,
  queryFn: () => Promise<OrdenServicio[]> = () =>
    db
      .select()
      .from(ordenServicio)
      .where(buildOrdenServicioWhere(filters))
      .orderBy(...buildOrdenServicioOrderBy(sort))
      .limit(window.limit)
      .offset(window.offset),
): Promise<OrdenServicio[]> {
  return queryFn();
}

/** R21 — total count for the same filter, for pagination math. */
export async function countOrdenesServicio(
  filters: OrdenServicioFilters,
  queryFn: () => Promise<number> = async () => {
    const rows = await db.select({ value: count() }).from(ordenServicio).where(buildOrdenServicioWhere(filters));
    return rows[0]?.value ?? 0;
  },
): Promise<number> {
  return queryFn();
}

/**
 * C4 — one vehicle's service-order history, most-recent first
 * (`orden_vehiculo_created_idx`).
 *
 * ponytail: unbounded on purpose. `listOrdenesServicio` three functions up
 * takes `{ offset, limit }` because its screen has a pager; this one has none,
 * so every row goes into the SSR payload. Add a limit the day a fleet vehicle
 * makes the row count matter — not before.
 *
 * And it is not the only ceiling on that screen: the page also calls
 * `getClienteById`, which returns the customer's ENTIRE order history in
 * `detail.orders` and never reads it (task 3.13). That reuse is deliberate —
 * it is what makes the ownership 404 free — but a customer with ten vehicles
 * pays the whole-customer history on every per-vehicle screen.
 */
export async function listOrdenesByVehiculo(
  vehiculoId: string,
  queryFn: () => Promise<OrdenServicio[]> = () =>
    db.select().from(ordenServicio).where(eq(ordenServicio.vehiculoId, vehiculoId)).orderBy(desc(ordenServicio.createdAt)),
): Promise<OrdenServicio[]> {
  return queryFn();
}

/** R20 — service-order detail + its line items. */
export async function getOrdenServicioById(
  id: string,
  queryFn: () => Promise<OrdenServicioDetail | null> = async () => {
    const rows = await db.select().from(ordenServicio).where(eq(ordenServicio.id, id)).limit(1);
    const orden = rows[0];
    if (!orden) return null;
    const items = await db.select().from(ordenServicioItem).where(eq(ordenServicioItem.ordenId, id));
    return { orden, items };
  },
): Promise<OrdenServicioDetail | null> {
  return queryFn();
}
