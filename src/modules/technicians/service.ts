/**
 * technicians/service.ts — roster writes (technicians-and-work-lines). The
 * DI seam is the same `deps?.x ?? realCall` convention as account/service.ts.
 *
 * Linking a login is the one administrador-only part: it decides which login
 * sees which orders, so a `jefe_taller` may not supply `userId` at all (even
 * `null`, which would unlink). The check runs before any read or write.
 */
import { eq } from "drizzle-orm";

import { can } from "@/modules/auth/policy";
import { db } from "@/shared/db/client";
import { tecnico, type Tecnico } from "@/shared/db/schema";
import { findLinkableUser, findTecnicoByUserId } from "./queries";

type Actor = { role: string };

export class TechnicianValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid technician input");
  }
}

/** A jefe_taller supplied `userId`; the route maps it to 403. */
export class TechnicianForbiddenError extends Error {
  constructor() {
    super("Solo un administrador puede vincular un usuario.");
  }
}

/** The login is already linked, or is not an active técnico; the route maps it to 409. */
export class TechnicianLinkError extends Error {}

export class TechnicianNotFoundError extends Error {
  constructor() {
    super("Technician not found");
  }
}

type TecnicoPatch = Partial<Pick<Tecnico, "nombre" | "userId" | "deactivatedAt">>;

export type TechnicianDeps = {
  insert?: (row: { nombre: string; userId: string | null }) => Promise<Tecnico>;
  update?: (id: string, set: TecnicoPatch) => Promise<Tecnico | null>;
  findByUserId?: (userId: string) => Promise<{ id: string } | null>;
  findLinkableUser?: (userId: string) => Promise<{ role: string; deactivatedAt: Date | null } | null>;
};

const BLANK_NAME = "El nombre es obligatorio.";

/** `tecnico_user_id_unique` lost a race the pre-check could not see. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === "23505";
}

async function assertLinkable(userId: string, selfId: string | null, deps: TechnicianDeps): Promise<void> {
  const user = await (deps.findLinkableUser ?? findLinkableUser)(userId);
  if (!user || user.role !== "tecnico" || user.deactivatedAt !== null) {
    throw new TechnicianLinkError("El usuario debe ser un técnico activo.");
  }
  const holder = await (deps.findByUserId ?? findTecnicoByUserId)(userId);
  if (holder && holder.id !== selfId) throw new TechnicianLinkError("Ese usuario ya está vinculado a otro técnico.");
}

export async function createTecnico(
  actor: Actor,
  input: { nombre?: string; userId?: string | null },
  deps: TechnicianDeps = {},
): Promise<Tecnico> {
  const userId = input.userId ?? null;
  if (userId !== null && !can(actor, "users.manage")) throw new TechnicianForbiddenError();

  const nombre = input.nombre?.trim() ?? "";
  if (!nombre) throw new TechnicianValidationError({ nombre: BLANK_NAME });

  if (userId !== null) await assertLinkable(userId, null, deps);

  const insert = deps.insert ?? (async (r) => (await db.insert(tecnico).values(r).returning())[0]);
  try {
    return await insert({ nombre, userId });
  } catch (err) {
    if (isUniqueViolation(err)) throw new TechnicianLinkError("Ese usuario ya está vinculado a otro técnico.");
    throw err;
  }
}

/** Rename, link/unlink (`userId`, administrador only) and deactivate/reactivate (`active`). */
export async function updateTecnico(
  actor: Actor,
  id: string,
  input: { nombre?: string; userId?: string | null; active?: boolean },
  deps: TechnicianDeps = {},
): Promise<Tecnico> {
  if (input.userId !== undefined && !can(actor, "users.manage")) throw new TechnicianForbiddenError();

  const set: TecnicoPatch = {};
  if (input.nombre !== undefined) {
    const nombre = input.nombre.trim();
    if (!nombre) throw new TechnicianValidationError({ nombre: BLANK_NAME });
    set.nombre = nombre;
  }
  if (input.userId !== undefined) {
    if (input.userId !== null) await assertLinkable(input.userId, id, deps);
    set.userId = input.userId;
  }
  if (input.active !== undefined) set.deactivatedAt = input.active ? null : new Date();
  if (Object.keys(set).length === 0) throw new TechnicianValidationError({ nombre: "No hay cambios para guardar." });

  const update =
    deps.update ?? (async (rowId, patch) => (await db.update(tecnico).set(patch).where(eq(tecnico.id, rowId)).returning())[0] ?? null);
  let updated: Tecnico | null;
  try {
    updated = await update(id, set);
  } catch (err) {
    if (isUniqueViolation(err)) throw new TechnicianLinkError("Ese usuario ya está vinculado a otro técnico.");
    throw err;
  }
  if (!updated) throw new TechnicianNotFoundError();
  return updated;
}
