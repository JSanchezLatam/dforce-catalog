/**
 * customers/consent.ts — the Ley 81 consent record for the customer portal
 * (customer-portal WU1). Append-only: see `clienteConsentimiento` in schema.ts.
 *
 * The decision is a pure function (`decideConsent`) so its branches are
 * unit-tested; the SQL around it — the row lock, the latest-row read, the
 * insert — is proven only by `src/e2e/portal-consent.e2e.test.ts`.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { cliente, clienteConsentimiento, users } from "@/shared/db/schema";
import { generatePortalToken, tokenAfterConsent } from "./portal-token";
import { ClienteDeactivatedError, ClienteNotFoundError } from "./service";

/** Bump with every change to the clause text; rows keep the version they were recorded under. */
export const CONSENT_CLAUSE_VERSION = "2026-10-provisional-1";

export type ConsentState = {
  granted: boolean;
  clauseVersion: string;
  recordedAt: Date;
  /** `null` when the recording user has since been deleted. */
  recordedByName: string | null;
};

export type ConsentDecision = "not_found" | "deactivated" | "unchanged" | "append";

/**
 * `latest` is the `granted` of the customer's newest row, `undefined` for none.
 * A repeat of the current state appends nothing: no row means no consent, so
 * revoking "nothing" has nothing to record either.
 */
export function decideConsent(
  target: { deactivatedAt: Date | null } | undefined,
  latest: boolean | undefined,
  wanted: boolean,
): ConsentDecision {
  if (!target) return "not_found";
  if (target.deactivatedAt) return "deactivated";
  return (latest ?? false) === wanted ? "unchanged" : "append";
}

export class PortalConsentRequiredError extends Error {
  constructor(public readonly clienteId: string) {
    super(`Customer ${clienteId} has no current portal consent`);
    this.name = "PortalConsentRequiredError";
  }
}

export type RotationDecision = "not_found" | "deactivated" | "no_consent" | "rotate";

/** A token exists only under current consent, so rotation needs an active customer whose latest row is a grant. */
export function decideRotation(
  target: { deactivatedAt: Date | null } | undefined,
  latest: boolean | undefined,
): RotationDecision {
  if (!target) return "not_found";
  if (target.deactivatedAt) return "deactivated";
  return latest === true ? "rotate" : "no_consent";
}

const stateColumns = {
  granted: clienteConsentimiento.granted,
  clauseVersion: clienteConsentimiento.clauseVersion,
  recordedAt: clienteConsentimiento.recordedAt,
  // `username` is NOT NULL, so someone is always named while the user exists.
  recordedByName: sql<string | null>`coalesce(${users.name}, ${users.username})`,
};

/** Latest row first by `recorded_at`; `id` only breaks an exact tie (it is a random uuid, never an order). */
const newestFirst = [desc(clienteConsentimiento.recordedAt), desc(clienteConsentimiento.id)] as const;

/** The customer's current consent, or `null` when no row was ever recorded. */
export async function currentConsent(clienteId: string): Promise<ConsentState | null> {
  const [row] = await db
    .select(stateColumns)
    .from(clienteConsentimiento)
    .leftJoin(users, eq(users.id, clienteConsentimiento.recordedBy))
    .where(eq(clienteConsentimiento.clienteId, clienteId))
    .orderBy(...newestFirst)
    .limit(1);
  return row ?? null;
}

/**
 * Records a grant or a revoke for one customer. The `cliente` row is locked
 * FOR UPDATE, so the read of the latest row and the insert cannot interleave
 * with another request for the same customer (two simultaneous grants append
 * one row), and the deactivated check reads the LOCKED row.
 *
 * The portal token follows the consent in the SAME transaction (customer-portal
 * WU2): a grant issues one when the customer has none, a revoke nulls it. It is
 * written AFTER the consent row, so a failure on the token (the e2e forces a
 * UNIQUE collision) rolls the row back with it. `deps.generateToken` exists for
 * that e2e only.
 *
 * `recorded_at` is `clock_timestamp()`, not the column default: `now()` is the
 * start of the transaction, so a request that began first but won the lock
 * second would be stamped OLDER than the row it follows and the current state
 * would read backwards.
 */
export async function recordConsent(
  clienteId: string,
  granted: boolean,
  userId: string,
  deps: { generateToken?: () => string } = {},
): Promise<{ changed: boolean; consent: ConsentState | null }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ deactivatedAt: cliente.deactivatedAt, portalToken: cliente.portalToken })
      .from(cliente)
      .where(eq(cliente.id, clienteId))
      .for("update");
    const [latest] = await tx
      .select({ granted: clienteConsentimiento.granted })
      .from(clienteConsentimiento)
      .where(eq(clienteConsentimiento.clienteId, clienteId))
      .orderBy(...newestFirst)
      .limit(1);

    const decision = decideConsent(target, latest?.granted, granted);
    if (decision === "not_found") throw new ClienteNotFoundError(clienteId);
    if (decision === "deactivated") throw new ClienteDeactivatedError(clienteId);
    if (decision === "append") {
      await tx.insert(clienteConsentimiento).values({
        clienteId,
        granted,
        clauseVersion: CONSENT_CLAUSE_VERSION,
        recordedBy: userId,
        recordedAt: sql`clock_timestamp()`,
      });
      await tx
        .update(cliente)
        .set({ portalToken: tokenAfterConsent(granted, target?.portalToken ?? null, deps.generateToken) })
        .where(eq(cliente.id, clienteId));
    }

    const [row] = await tx
      .select(stateColumns)
      .from(clienteConsentimiento)
      .leftJoin(users, eq(users.id, clienteConsentimiento.recordedBy))
      .where(eq(clienteConsentimiento.clienteId, clienteId))
      .orderBy(...newestFirst)
      .limit(1);
    return { changed: decision === "append", consent: row ?? null };
  });
}

/**
 * Replaces the customer's portal token ("Generar nuevo código"). Every QR
 * printed with the old one stops working once the sync completes. One locked
 * transaction: the decision reads the LOCKED row and the latest consent, so a
 * revoke racing a rotate cannot leave a token behind a revoked consent.
 * `deps.generateToken` exists for tests only.
 */
export async function rotatePortalToken(clienteId: string, deps: { generateToken?: () => string } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ deactivatedAt: cliente.deactivatedAt })
      .from(cliente)
      .where(eq(cliente.id, clienteId))
      .for("update");
    const [latest] = await tx
      .select({ granted: clienteConsentimiento.granted })
      .from(clienteConsentimiento)
      .where(eq(clienteConsentimiento.clienteId, clienteId))
      .orderBy(...newestFirst)
      .limit(1);

    const decision = decideRotation(target, latest?.granted);
    if (decision === "not_found") throw new ClienteNotFoundError(clienteId);
    if (decision === "deactivated") throw new ClienteDeactivatedError(clienteId);
    if (decision === "no_consent") throw new PortalConsentRequiredError(clienteId);

    await tx
      .update(cliente)
      .set({ portalToken: (deps.generateToken ?? generatePortalToken)() })
      .where(eq(cliente.id, clienteId));
  });
}
