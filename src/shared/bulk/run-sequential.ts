/**
 * The only way a bulk action executes in this app (design.md D1/D2).
 *
 * Pure and DB-free: it owns the ORDER of the requests and nothing about what
 * they are. `apply` is the per-row request the calling capability already has
 * a single-row route for, so bulk stays a caller and never becomes a new
 * capability with its own SQL, its own route and its own permission surface.
 *
 * **One row in flight, always.** This is the reason the file exists. Every
 * per-row precondition in this app is re-read inside that row's own
 * transaction — `deactivateUser()` re-queries `activeAdminIds`,
 * `assertTransition()` reads the row's current status — and under
 * `read committed` (verified against this app's Postgres) that is only enough
 * while the transactions do not overlap. Two concurrent `deactivateUser`
 * calls both see two active admins, both pass `checkAdminSafety`, and both
 * commit. `Promise.all` here would leave zero administrators with every
 * individual guard intact, which is why `run-sequential.test.ts`'s first case
 * is mutation-verified against exactly that swap.
 */

export type RowOutcome = { id: string; ok: boolean; reason?: string };

/**
 * A plain `{ aborted: boolean }` rather than an `AbortSignal`: nothing here
 * aborts an in-flight request — the row that is already running is allowed to
 * finish and be reported, and only the NEXT one is skipped. A real
 * `AbortSignal` is structurally compatible, so a caller that has one can pass
 * it unchanged.
 */
export async function runSequential(
  ids: readonly string[],
  apply: (id: string) => Promise<RowOutcome>,
  signal?: { aborted: boolean },
): Promise<RowOutcome[]> {
  const outcomes: RowOutcome[] = [];
  for (const id of ids) {
    if (signal?.aborted) break;
    try {
      outcomes.push(await apply(id));
    } catch {
      // A rejected `fetch` is one row's failure, not the batch's. Letting it
      // propagate would discard the outcomes of every row that already
      // applied, and the result panel's whole contract is naming them.
      // `request_failed` is a machine code like `last_active_admin` and
      // `invalid_transition`; the Spanish belongs to the capability's map.
      outcomes.push({ id, ok: false, reason: "request_failed" });
    }
  }
  return outcomes;
}
