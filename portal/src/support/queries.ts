import { and, count, desc, eq } from "drizzle-orm";

import { db } from "../db/client";
import { supportFeedback as t } from "../db/schema";
import { CATEGORY_LABELS, ROLE_LABELS, STATUS_LABELS, type Category, type Role, type Status } from "./format";

export interface Filters {
  status?: Status;
  category?: Category;
  role?: Role;
}

const known = <T extends string>(labels: Record<T, string>, value: string | string[] | undefined): T | undefined =>
  typeof value === "string" && Object.hasOwn(labels, value) ? (value as T) : undefined;

/** URL search params to filters. Anything unknown is dropped, so only the fixed sets reach SQL. */
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const f: Filters = {
    status: known(STATUS_LABELS, params.status),
    category: known(CATEGORY_LABELS, params.category),
    role: known(ROLE_LABELS, params.role),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Filters;
}

/** `?id=…&status=…` for a link that keeps the current filters; empty when there is nothing to say. */
export function queryString(filters: Filters, id?: string): string {
  const qs = new URLSearchParams(id ? { id } : {});
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  return qs.size ? `?${qs}` : "";
}

export interface FeedbackListRow {
  id: string;
  username: string;
  role: string;
  category: string;
  status: string;
  screenLabel: string;
  createdAt: Date;
  receivedAt: Date;
}

/** Newest first by when it was written. The comment text is not selected: the list does not show it. */
export function listFeedback(filters: Filters): Promise<FeedbackListRow[]> {
  return db
    .select({
      id: t.id,
      username: t.username,
      role: t.role,
      category: t.category,
      status: t.status,
      screenLabel: t.screenLabel,
      createdAt: t.createdAt,
      receivedAt: t.receivedAt,
    })
    .from(t)
    .where(and(filters.status && eq(t.status, filters.status), filters.category && eq(t.category, filters.category), filters.role && eq(t.role, filters.role)))
    .orderBy(desc(t.createdAt));
}

/** One GROUP BY over the whole inbox: the chips show what each status holds, whatever the other filters say. */
export async function statusCounts(): Promise<Record<Status, number>> {
  const rows = await db.select({ status: t.status, n: count() }).from(t).groupBy(t.status);
  const out: Record<Status, number> = { nuevo: 0, leido: 0, resuelto: 0 };
  for (const r of rows) if (r.status in out) out[r.status as Status] = r.n;
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id column is a uuid: anything else would make Postgres throw instead of matching nothing. */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export interface FeedbackDetail extends FeedbackListRow {
  text: string;
  internalNote: string;
}

/** Opening a Nuevo comment reads it. The status guard in the WHERE is what keeps Leído and Resuelto untouched. */
export async function markRead(id: string): Promise<void> {
  await db.update(t).set({ status: "leido" }).where(and(eq(t.id, id), eq(t.status, "nuevo")));
}

export async function getFeedback(id: string): Promise<FeedbackDetail | undefined> {
  return (await db.select().from(t).where(eq(t.id, id)))[0];
}

/** The note REPLACES the previous one. False when no row has that id. */
export async function updateFeedback(id: string, patch: { status?: Status; note?: string }): Promise<boolean> {
  const set = { ...(patch.status && { status: patch.status }), ...(patch.note !== undefined && { internalNote: patch.note }) };
  const rows = await db.update(t).set(set).where(eq(t.id, id)).returning({ id: t.id });
  return rows.length > 0;
}
