import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { portalCustomer, portalTermsAcceptance } from "./schema";

const cols = (t: Parameters<typeof getTableConfig>[0]) =>
  Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, c]));

describe("portal schema", () => {
  it("portal_customer: nullable token_hash and snapshot, not-null version and synced_at", () => {
    const c = cols(portalCustomer);
    expect(Object.keys(c).sort()).toEqual(["cliente_id", "snapshot", "synced_at", "token_hash", "version"]);
    expect(c.cliente_id.primary).toBe(true);
    expect(c.token_hash.notNull).toBe(false);
    expect(c.token_hash.isUnique).toBe(true);
    expect(c.snapshot.notNull).toBe(false);
    expect(c.version.notNull).toBe(true);
    expect(c.synced_at.notNull).toBe(true);
  });

  it("portal_terms_acceptance: bigserial id and a not-null acceptance record", () => {
    const c = cols(portalTermsAcceptance);
    expect(Object.keys(c).sort()).toEqual(["accepted_at", "id", "terms_version", "token_hash"]);
    expect(c.id.primary).toBe(true);
    expect(c.id.columnType).toBe("PgBigSerial53");
    for (const name of ["token_hash", "terms_version", "accepted_at"]) expect(c[name].notNull).toBe(true);
  });

  it("portal_terms_acceptance: one acceptance per (token_hash, terms_version), enforced by a unique index", () => {
    const unique = getTableConfig(portalTermsAcceptance).indexes.filter((i) => i.config.unique);
    expect(unique.map((i) => i.config.columns.map((c) => ("name" in c ? c.name : "")))).toEqual([
      ["token_hash", "terms_version"],
    ]);
  });
});
