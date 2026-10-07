import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "../db/client";
import { portalCustomer, portalTermsAcceptance } from "../db/schema";
import { TERMS_VERSION } from "../terms";

export type PortalSnapshot = NonNullable<typeof portalCustomer.$inferSelect.snapshot>;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * ONE indexed query for every token, valid or not: the snapshot and whether this
 * token accepted the CURRENT terms version. A revoked or tombstoned customer has a
 * NULL token_hash, so it is simply "no row" — indistinguishable from never issued.
 */
export async function findByToken(token: string): Promise<{ snapshot: PortalSnapshot; accepted: boolean } | null> {
  const hash = hashToken(token);
  const [row] = await db
    .select({
      snapshot: portalCustomer.snapshot,
      accepted: sql<boolean>`exists (select 1 from ${portalTermsAcceptance} where ${portalTermsAcceptance.tokenHash} = ${hash} and ${portalTermsAcceptance.termsVersion} = ${TERMS_VERSION})`,
    })
    .from(portalCustomer)
    .where(eq(portalCustomer.tokenHash, hash))
    .limit(1);
  return row?.snapshot ? { snapshot: row.snapshot, accepted: row.accepted } : null;
}
