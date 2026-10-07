import { db } from "../db/client";
import { portalTermsAcceptance } from "../db/schema";
import { TERMS_VERSION } from "../terms";
import { hashToken } from "./lookup";

/**
 * One row per (token hash, current terms version). The unique index decides, so a
 * repeat or a concurrent accept inserts nothing and is not an error.
 */
export async function recordAcceptance(token: string): Promise<void> {
  await db
    .insert(portalTermsAcceptance)
    .values({ tokenHash: hashToken(token), termsVersion: TERMS_VERSION })
    .onConflictDoNothing();
}
