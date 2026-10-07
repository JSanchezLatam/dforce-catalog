import { sql } from "drizzle-orm";

import { db } from "../db/client";
import { portalTermsAcceptance } from "../db/schema";
import { TERMS_VERSION } from "../terms";
import { hashToken } from "./lookup";

/** One row per (token hash, current terms version); a repeat accept inserts nothing. */
export async function recordAcceptance(token: string): Promise<void> {
  const hash = hashToken(token);
  await db.execute(sql`
    insert into ${portalTermsAcceptance} (token_hash, terms_version)
    select ${hash}::text, ${TERMS_VERSION}::text
    where not exists (
      select 1 from ${portalTermsAcceptance}
      where token_hash = ${hash} and terms_version = ${TERMS_VERSION}
    )`);
}
