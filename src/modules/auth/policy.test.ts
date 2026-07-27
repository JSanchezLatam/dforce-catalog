import { describe, expect, it } from "vitest";

import { can, type Action, type Grants } from "./policy";

type Row = { action: Action; grants: Grants };

const adminGrants: Grants = {
  "customers.read": true,
  "customers.write": true,
  "service-orders.read": true,
  "service-orders.write": true,
  "inventory.read": true,
  "catalogs.read": true,
  "catalogs.download": true,
  "catalogs.generate": true,
  "catalogs.listAll": true,
  "template.edit": true,
  "workshop.edit": true,
  "users.manage": true,
  "sync.manual": true,
  "account.self": true,
};

const tecnicoGrants: Grants = {
  "customers.read": true,
  "customers.write": true,
  "service-orders.read": true,
  "service-orders.write": true,
  "inventory.read": true,
  "catalogs.read": true,
  "catalogs.download": true,
  "catalogs.generate": false,
  "catalogs.listAll": false,
  "template.edit": false,
  "workshop.edit": false,
  "users.manage": false,
  "sync.manual": false,
  "account.self": true,
};

describe("can() — role × action permission matrix", () => {
  it("grants every action to administrador", () => {
    const user = { id: "a", role: "administrador" as const };
    for (const [action, expected] of Object.entries(adminGrants)) {
      expect(can(user, action as Action)).toBe(expected);
    }
  });

  it("grants only the allowed actions to tecnico", () => {
    const user = { id: "b", role: "tecnico" as const };
    for (const [action, expected] of Object.entries(tecnicoGrants)) {
      expect(can(user, action as Action)).toBe(expected);
    }
  });

  it("defaults to deny for an unknown role (ghost)", () => {
    const user = { id: "c", role: "ghost" as never };
    for (const action of Object.keys(adminGrants) as Action[]) {
      expect(can(user, action)).toBe(false);
    }
  });
});
