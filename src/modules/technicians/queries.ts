/**
 * technicians/queries.ts — reads over the `tecnico` roster. No delete anywhere:
 * a technician leaves the roster by `deactivated_at`, never by a DELETE.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { tecnico, users, type Tecnico } from "@/shared/db/schema";

/** Active-only by default: a deactivated technician is never offered for new work. */
export async function listTecnicos(options: { includeInactive?: boolean } = {}): Promise<Tecnico[]> {
  const query = db.select().from(tecnico).orderBy(asc(tecnico.nombre));
  return options.includeInactive ? query : query.where(isNull(tecnico.deactivatedAt));
}

export async function findTecnicoByUserId(userId: string): Promise<{ id: string } | null> {
  return (await db.select({ id: tecnico.id }).from(tecnico).where(eq(tecnico.userId, userId)).limit(1))[0] ?? null;
}

/** What a roster link needs to know about a login: it must exist, be a técnico and be active. */
export async function findLinkableUser(userId: string): Promise<{ role: string; deactivatedAt: Date | null } | null> {
  return (
    (await db.select({ role: users.role, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.id, userId)).limit(1))[0] ??
    null
  );
}

export type RosterRow = Tecnico & { username: string | null };

/** The roster page: every row, deactivated included (the page filters), with the linked login's username. */
export async function listRoster(): Promise<RosterRow[]> {
  const rows = await db
    .select({ row: tecnico, username: users.username })
    .from(tecnico)
    .leftJoin(users, eq(users.id, tecnico.userId))
    .orderBy(asc(tecnico.nombre));
  return rows.map((r) => ({ ...r.row, username: r.username }));
}

/** Logins an administrador may link a roster row to: active, role técnico (what `assertLinkable` accepts). */
export async function listTecnicoLogins(): Promise<{ id: string; username: string }[]> {
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(eq(users.role, "tecnico"), isNull(users.deactivatedAt)))
    .orderBy(asc(users.username));
}
