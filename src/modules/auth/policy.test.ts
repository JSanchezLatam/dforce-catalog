import { describe, expect, it } from "vitest";

import { can, type Action } from "./policy";
import type { SessionUser } from "./session";

const admin: SessionUser = { id: "admin-1", role: "administrador" };
const user: SessionUser = { id: "user-1", role: "usuario" };

const adminOnlyActions: Action[] = ["sync.manual", "template.edit", "catalogs.listAll"];

describe("can() — 403 policy matrix (R9.6, NFR-8)", () => {
  it.each(adminOnlyActions)("allows administrador to perform %s", (action) => {
    expect(can(admin, action)).toBe(true);
  });

  it.each(adminOnlyActions)("denies usuario for %s (403 at the route level)", (action) => {
    expect(can(user, action)).toBe(false);
  });
});
