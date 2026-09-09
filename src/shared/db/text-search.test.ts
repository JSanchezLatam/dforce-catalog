import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { cliente } from "@/shared/db/schema";
import { unaccentIlike } from "./text-search";

/**
 * Retrofit test (AGENTS.md's Strict-TDD carve-out) — `unaccentIlike` moved
 * here verbatim from `customers/queries.ts` (design D8), so no real RED is
 * possible on a pure relocation. Meaningfulness is checked by mutation
 * instead: temporarily swap `ilike` for `like` and confirm this goes red
 * (recorded in apply-progress, not left as a claim).
 */
describe("unaccentIlike", () => {
  it("wraps both the column and the pattern in unaccent(), joined by ilike", () => {
    const rendered = new PgDialect().sqlToQuery(sql`${unaccentIlike(cliente.name, "%x%")}`);
    expect((rendered.sql.match(/unaccent\(/g) ?? []).length).toBe(2);
    expect(rendered.sql).toContain("ilike");
    expect(rendered.sql).not.toContain(" like ");
  });
});
