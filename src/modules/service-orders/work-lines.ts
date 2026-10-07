/**
 * service-orders/work-lines.ts — per-technician work lines (order-work-lines).
 *
 * Every write takes the order lock first (`lockOrderForMutation`), so the status
 * gate reads the LOCKED row and a concurrent close cannot slip between check and
 * write. Staff (`canManageAll`) write any assigned technician's line while the
 * order is `in_progress` or `ready_for_review`; a técnico only their own, only
 * `in_progress`, and not after marking "Mi parte lista". Nobody writes on `open`.
 *
 * A closed order is writable only with an administrator `CorrectionGrant`, and
 * then each change gets its audit row(s) in the SAME transaction. A jefe never
 * holds a grant (the route passes none), so they get `OrderClosedError`.
 *
 * The line's technician being assigned is a composite FK; the explicit check
 * below only exists to answer in Spanish instead of with a constraint error.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenLineaTrabajo, ordenTecnico, tecnico } from "@/shared/db/schema";
import { toWorkshopDateKey } from "@/shared/datetime";
import { lockOrderForMutation, recordCorrections, type CorrectionGrant, type Tx } from "./order-lock";
import type { OrderScope } from "./scope";

export class WorkLineValidationError extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("Invalid work line");
  }
}

/** A técnico naming someone else's line or technician (403). */
export class WorkLineForbiddenError extends Error {
  constructor() {
    super("Solo podés cargar tus propias líneas de trabajo");
  }
}

/** A técnico who already marked "Mi parte lista" (409). */
export class WorkLineRefusedError extends Error {
  constructor() {
    super("Desmarcá tu parte lista antes de cambiar líneas de trabajo");
  }
}

export class WorkLineNotFoundError extends Error {
  constructor() {
    super("La línea de trabajo no existe en esta orden");
  }
}

/** `canManageAll` is `can(user, "service-orders.assign")`, evaluated by the route (same split as transitions). */
export type WorkLineActor = { id: string; canManageAll: boolean };
export type WorkLineDeps = { db?: typeof db; now?: () => Date };

const MAX_DESCRIPTION = 1000;

type Fields = { descripcion: string; duracionMinutos: number; fecha: string };

/** Validates only the keys that are present (an edit); `required` makes absence an error (an add). */
function parseFields(
  raw: { descripcion?: unknown; duracionMinutos?: unknown; fecha?: unknown },
  required: boolean,
): Partial<Fields> {
  const errors: Record<string, string> = {};
  const out: Partial<Fields> = {};

  if (required || raw.descripcion !== undefined) {
    const text = typeof raw.descripcion === "string" ? raw.descripcion.trim() : "";
    if (text === "" || text.length > MAX_DESCRIPTION) {
      errors.descripcion = text === "" ? "Escribí qué se hizo" : `La descripción admite hasta ${MAX_DESCRIPTION} caracteres`;
    } else out.descripcion = text;
  }
  if (required || raw.duracionMinutos !== undefined) {
    const n = raw.duracionMinutos;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1440) {
      errors.duracionMinutos = "Los minutos tienen que ser un entero entre 1 y 1440";
    } else out.duracionMinutos = n;
  }
  if (raw.fecha !== undefined) {
    const f = raw.fecha;
    const real = typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
    if (!real) errors.fecha = "La fecha no es válida";
    else out.fecha = f;
  }
  if (Object.keys(errors).length > 0) throw new WorkLineValidationError(errors);
  return out;
}

async function loadAssignment(tx: Tx, ordenId: string, tecnicoId: string) {
  const [row] = await tx
    .select({ parteListaAt: ordenTecnico.parteListaAt })
    .from(ordenTecnico)
    .where(and(eq(ordenTecnico.ordenId, ordenId), eq(ordenTecnico.tecnicoId, tecnicoId)));
  return row;
}

/** A técnico's own roster row, or null when their login is not linked to one. */
async function ownTecnicoId(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx.select({ id: tecnico.id }).from(tecnico).where(eq(tecnico.userId, userId));
  return row?.id ?? null;
}

/** Statuses a line may be written in; the lock refuses (and, when closed, offers correction for) the rest. */
const canWriteFor = (actor: WorkLineActor) => (status: string) =>
  status === "in_progress" || (actor.canManageAll && status === "ready_for_review");

export async function addWorkLine(
  input: {
    ordenId: string;
    tecnicoId: string;
    descripcion: unknown;
    duracionMinutos: unknown;
    fecha?: unknown;
    actor: WorkLineActor;
    scope: OrderScope;
    correction?: CorrectionGrant;
  },
  deps: WorkLineDeps = {},
): Promise<{ id: string }> {
  const fields = parseFields(input, true) as Fields & { fecha?: string };
  // ponytail: the default is read once per attempt; a request straddling Panama midnight keeps the earlier day.
  const fecha = fields.fecha ?? toWorkshopDateKey((deps.now ?? (() => new Date()))());

  return (deps.db ?? db).transaction(async (tx) => {
    const { correcting } = await lockOrderForMutation(tx, input.ordenId, {
      scope: input.scope,
      canWrite: canWriteFor(input.actor),
      correction: input.correction,
    });
    if (!input.actor.canManageAll && (await ownTecnicoId(tx, input.actor.id)) !== input.tecnicoId) {
      throw new WorkLineForbiddenError();
    }
    const assignment = await loadAssignment(tx, input.ordenId, input.tecnicoId);
    if (!assignment) throw new WorkLineValidationError({ tecnicoId: "Ese técnico no está asignado a la orden" });
    if (!input.actor.canManageAll && assignment.parteListaAt) throw new WorkLineRefusedError();

    const [row] = await tx
      .insert(ordenLineaTrabajo)
      .values({
        ordenId: input.ordenId,
        tecnicoId: input.tecnicoId,
        descripcion: fields.descripcion,
        duracionMinutos: fields.duracionMinutos,
        fecha,
        createdBy: input.actor.id,
      })
      .returning({ id: ordenLineaTrabajo.id });
    if (correcting && input.correction) {
      await recordCorrections(tx, {
        ordenId: input.ordenId,
        userId: input.correction.correctorId,
        before: { linea_trabajo: null },
        after: { linea_trabajo: row.id },
      });
    }
    return { id: row.id };
  });
}

/** Locks, finds the line on THIS order, and applies the técnico rules to its technician. */
async function lockLine(
  tx: Tx,
  input: { ordenId: string; lineId: string; actor: WorkLineActor; scope: OrderScope; correction?: CorrectionGrant },
) {
  const { correcting } = await lockOrderForMutation(tx, input.ordenId, {
    scope: input.scope,
    canWrite: canWriteFor(input.actor),
    correction: input.correction,
  });
  const [line] = await tx
    .select()
    .from(ordenLineaTrabajo)
    .where(and(eq(ordenLineaTrabajo.id, input.lineId), eq(ordenLineaTrabajo.ordenId, input.ordenId)));
  if (!line) throw new WorkLineNotFoundError();
  if (!input.actor.canManageAll) {
    if ((await ownTecnicoId(tx, input.actor.id)) !== line.tecnicoId) throw new WorkLineForbiddenError();
    if ((await loadAssignment(tx, input.ordenId, line.tecnicoId))?.parteListaAt) throw new WorkLineRefusedError();
  }
  return { line, correcting };
}

/** Audit field names are the spec's (`description`), not the column's. */
const AUDIT_FIELD = { descripcion: "description", duracionMinutos: "duracion_minutos", fecha: "fecha" } as const;

export async function updateWorkLine(
  input: {
    ordenId: string;
    lineId: string;
    patch: { descripcion?: unknown; duracionMinutos?: unknown; fecha?: unknown };
    actor: WorkLineActor;
    scope: OrderScope;
    correction?: CorrectionGrant;
  },
  deps: WorkLineDeps = {},
): Promise<void> {
  // Only these three keys are ever read from the patch: the technician and the order are immutable.
  const changes = parseFields(input.patch, false);
  if (Object.keys(changes).length === 0) throw new WorkLineValidationError({ form: "No hay cambios para guardar" });

  await (deps.db ?? db).transaction(async (tx) => {
    const { line, correcting } = await lockLine(tx, input);
    await tx
      .update(ordenLineaTrabajo)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(ordenLineaTrabajo.id, input.lineId));
    if (correcting && input.correction) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(changes) as (keyof Fields)[]) {
        before[`linea_trabajo.${AUDIT_FIELD[key]}`] = `${line.id}: ${line[key]}`;
        after[`linea_trabajo.${AUDIT_FIELD[key]}`] = `${line.id}: ${changes[key]}`;
      }
      await recordCorrections(tx, { ordenId: input.ordenId, userId: input.correction.correctorId, before, after });
    }
  });
}

export async function deleteWorkLine(
  input: { ordenId: string; lineId: string; actor: WorkLineActor; scope: OrderScope; correction?: CorrectionGrant },
  deps: WorkLineDeps = {},
): Promise<void> {
  await (deps.db ?? db).transaction(async (tx) => {
    const { line, correcting } = await lockLine(tx, input);
    await tx.delete(ordenLineaTrabajo).where(eq(ordenLineaTrabajo.id, input.lineId));
    if (correcting && input.correction) {
      await recordCorrections(tx, {
        ordenId: input.ordenId,
        userId: input.correction.correctorId,
        before: { linea_trabajo: line.id },
        after: { linea_trabajo: null },
      });
    }
  });
}
