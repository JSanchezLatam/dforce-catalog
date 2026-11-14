import { describe, expect, it } from "vitest";

import { isUsageScreen, upsertViewStatement } from "./service";

describe("isUsageScreen", () => {
  it.each(["/agenda", "/service-orders/[id]", "/customers/[id]/vehicles/[vehicleId]"])("accepts the pattern %s", (s) => {
    expect(isUsageScreen(s)).toBe(true);
  });

  it.each([
    "/service-orders/123",
    "/nope",
    "/agenda/",
    "/agenda?x=1",
    "",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
  ])("refuses %j", (s) => {
    expect(isUsageScreen(s)).toBe(false);
  });

  it.each([null, undefined, 1, {}, ["/agenda"]])("refuses the non-string %j", (s) => {
    expect(isUsageScreen(s)).toBe(false);
  });
});

// The e2e is the arbiter of the SQL; this pins the two clauses a wrong clock or an overwrite would change,
// because the UTC and Panama dates agree for 19 hours a day and the e2e cannot tell them apart then.
describe("upsertViewStatement", () => {
  const { sql, params } = upsertViewStatement("/agenda", "gestion").toSQL();

  it("computes the day in the database, on the Panama clock", () => {
    expect(sql).toContain("(now() AT TIME ZONE 'America/Panama')::date");
  });

  it("increments the existing row instead of overwriting it", () => {
    expect(sql).toMatch(/on conflict \("day","screen","role_group"\) do update set "views" = "usage_daily"\."views" \+ 1/);
  });

  it("binds the screen and group as parameters", () => {
    expect(params).toEqual(expect.arrayContaining(["/agenda", "gestion"]));
  });
});
