/**
 * service-orders/parte-lista.ts — "Mi parte lista": a technician marks (or
 * un-marks) THEIR OWN assignment as finished.
 *
 * Both run under `lockOrderForMutation`, then recompute readiness in the same
 * transaction (`applyReadiness`), so two simultaneous last marks serialize on the
 * order row and exactly one of them makes it `ready_for_review`.
 *
 * A closed order refuses every role and is NOT correctable: nothing here takes a
 * `CorrectionGrant`, so `OrderClosedError` is the only answer, as for assignment.
 * Staff mark only a part of their own too (an administrador linked to a roster
 * row); marking someone else's part is out of scope.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenTecnico, tecnico } from "@/shared/db/schema";
import { lockOrderForMutation, type Tx } from "./order-lock";
import { applyReadiness } from "./readiness";
import type { OrderScope } from "./scope";
import type { OrderStatus } from "./transitions";

/** Naming another technician's assignment, or having none on this order (403). */
export class ParteListaForbiddenError extends Error {
  constructor() {
    super("Solo podés marcar tu propia parte");
  }
}

/** Marking a marked part, or un-marking a pending one (409). */
export class ParteListaRefusedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ParteListaDeps = { db?: typeof db };
type Input = { ordenId: string; userId: string; tecnicoId?: string; scope: OrderScope };

async function setMark(input: Input, marking: boolean, deps: ParteListaDeps): Promise<{ status: OrderStatus }> {
  return (deps.db ?? db).transaction(async (tx: Tx) => {
    // Marking is only for `in_progress`; un-marking also from `ready_for_review`, which is how a part is reopened.
    const { order } = await lockOrderForMutation(tx, input.ordenId, {
      scope: input.scope,
      canWrite: (status) => status === "in_progress" || (!marking && status === "ready_for_review"),
    });

    const [own] = await tx.select({ id: tecnico.id }).from(tecnico).where(eq(tecnico.userId, input.userId));
    if (!own || (input.tecnicoId !== undefined && input.tecnicoId !== own.id)) throw new ParteListaForbiddenError();
    const [assignment] = await tx
      .select({ parteListaAt: ordenTecnico.parteListaAt })
      .from(ordenTecnico)
      .where(and(eq(ordenTecnico.ordenId, input.ordenId), eq(ordenTecnico.tecnicoId, own.id)));
    if (!assignment) throw new ParteListaForbiddenError();
    if (marking && assignment.parteListaAt) throw new ParteListaRefusedError("Tu parte ya está marcada como lista");
    if (!marking && !assignment.parteListaAt) throw new ParteListaRefusedError("Tu parte no está marcada como lista");

    await tx
      .update(ordenTecnico)
      .set({ parteListaAt: marking ? new Date() : null })
      .where(and(eq(ordenTecnico.ordenId, input.ordenId), eq(ordenTecnico.tecnicoId, own.id)));
    return { status: await applyReadiness(tx, order) };
  });
}

export const markParteLista = (input: Input, deps: ParteListaDeps = {}) => setMark(input, true, deps);
export const unmarkParteLista = (input: Input, deps: ParteListaDeps = {}) => setMark(input, false, deps);
