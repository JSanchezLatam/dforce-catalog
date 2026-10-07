import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { orderScope, SYSTEM_SCOPE } from "./scope";

const render = (where: NonNullable<ReturnType<typeof orderScope>["where"]>) => new PgDialect().sqlToQuery(where);

describe("orderScope", () => {
  it.each(["administrador", "jefe_taller"] as const)("adds no condition for %s (service-orders.readAll)", (role) => {
    expect(orderScope({ id: "u1", role }).where).toBeUndefined();
  });

  it("scopes a tecnico through their roster row's assignments, bound to their user id", () => {
    const where = orderScope({ id: "user-7", role: "tecnico" }).where;
    expect(where).toBeDefined();
    const { sql, params } = render(where!);
    expect(sql).toContain("exists");
    expect(sql).toContain('"orden_tecnico"');
    expect(sql).toContain('"tecnico"."user_id"');
    expect(sql).toContain('"orden_tecnico"."orden_id" = "orden_servicio"."id"');
    expect(params).toEqual(["user-7"]);
  });

  it("keeps a deactivated roster row's assigned orders visible (history stays reachable)", () => {
    expect(render(orderScope({ id: "u", role: "tecnico" }).where!).sql).not.toContain("deactivated_at");
  });

  it("fails closed for a role the matrix does not know", () => {
    expect(orderScope({ id: "u", role: "intruso" as never }).where).toBeDefined();
  });
});

describe("SYSTEM_SCOPE", () => {
  it("adds no condition: jobs and non-user callers see every order, by name", () => {
    expect(SYSTEM_SCOPE.where).toBeUndefined();
  });
});
