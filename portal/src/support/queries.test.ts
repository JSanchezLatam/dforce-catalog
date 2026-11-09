import { describe, expect, it } from "vitest";

import { parseFilters, queryString } from "./queries";

// The SQL (WHERE, GROUP BY, ORDER BY) is proven by e2e/support.e2e.test.ts, not here.
describe("parseFilters", () => {
  it("keeps known values", () => {
    expect(parseFilters({ status: "nuevo", category: "bug", role: "tecnico" })).toEqual({ status: "nuevo", category: "bug", role: "tecnico" });
  });
  it("drops unknown, empty and repeated values instead of passing them to SQL", () => {
    expect(parseFilters({ status: "todos", category: "", role: ["tecnico", "administrador"] })).toEqual({});
    expect(parseFilters({ status: "' OR 1=1 --" })).toEqual({});
  });
  it("takes nothing from other params", () => {
    expect(parseFilters({ id: "abc" })).toEqual({});
  });
});

describe("queryString", () => {
  it("writes only the set filters, and the selected id first", () => {
    expect(queryString({ status: "nuevo", role: "tecnico" }, "abc")).toBe("?id=abc&status=nuevo&role=tecnico");
    expect(queryString({})).toBe("");
  });
});
