import { describe, expect, it } from "vitest";

import { ACTIONS, can, type Action, type Grants } from "./policy";
import type { Role } from "./roles";

type Row = { action: Action; grants: Grants };

const adminGrants: Grants = {
  "customers.read": true,
  "customers.write": true,
  "customers.deleteVehicle": true,
  "customers.consent": true,
  "customers.portalRotate": true,
  "vencimientos.read": true,
  "vencimientos.contact": true,
  "service-orders.read": true,
  "service-orders.write": true,
  "service-orders.deletePhoto": true,
  "service-orders.correct": true,
  "inventory.read": true,
  "catalogs.read": true,
  "catalogs.download": true,
  "catalogs.generate": true,
  "catalogs.listAll": true,
  "template.edit": true,
  "workshop.read": true,
  "workshop.edit": true,
  "users.manage": true,
  "sync.manual": true,
  "account.self": true,
  "service-orders.readAll": true,
  "service-orders.create": true,
  "service-orders.assign": true,
  "technicians.manage": true,
  "metrics.read": true,
  "metrics.self": false,
  "board.customer": true,
  "board.read": true,
};

// Every administrador grant except the four the owner keeps for himself, and
// photo deletion, which the spec keeps administrador-only.
const jefeGrants: Grants = {
  ...adminGrants,
  "service-orders.deletePhoto": false,
  "users.manage": false,
  "workshop.edit": false,
  "template.edit": false,
  "service-orders.correct": false,
  "customers.portalRotate": false,
};

const tecnicoGrants: Grants = {
  "customers.read": true,
  "customers.write": true,
  "customers.deleteVehicle": false,
  "customers.consent": false,
  "customers.portalRotate": false,
  "vencimientos.read": false,
  "vencimientos.contact": false,
  "service-orders.read": true,
  "service-orders.write": true,
  "service-orders.deletePhoto": false,
  "service-orders.correct": false,
  "inventory.read": true,
  "catalogs.read": true,
  "catalogs.download": true,
  "catalogs.generate": false,
  "catalogs.listAll": true,
  "template.edit": false,
  "workshop.read": true,
  "workshop.edit": false,
  "users.manage": false,
  "sync.manual": false,
  "account.self": true,
  "service-orders.readAll": false,
  "service-orders.create": false,
  "service-orders.assign": false,
  "technicians.manage": false,
  "metrics.read": false,
  "metrics.self": true,
  "board.customer": false,
  "board.read": true,
};

// The big-screen account holds `board.customer` and nothing else.
const pantallaGrants: Grants = Object.fromEntries(ACTIONS.map((a) => [a, a === "board.customer"])) as unknown as Grants;

// Exhaustive over Role: a new role is a tsc error here until it has a row.
const GRANTS_BY_ROLE: Record<Role, Grants> = {
  administrador: adminGrants,
  jefe_taller: jefeGrants,
  tecnico: tecnicoGrants,
  pantalla: pantallaGrants,
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

  it("grants jefe_taller every administrador action except the owner-only four and photo deletion", () => {
    const user = { id: "j", role: "jefe_taller" as const };
    for (const [action, expected] of Object.entries(jefeGrants)) {
      expect(can(user, action as Action)).toBe(expected);
    }
  });

  it("Matrix row: pantalla is true for board.customer and false for every other action, including account.self and users.manage", () => {
    const user = { id: "p", role: "pantalla" as const };
    for (const action of ACTIONS) {
      expect(can(user, action)).toBe(action === "board.customer");
    }
  });

  it("Access Matrix: board.customer is for administrador, jefe_taller and pantalla, never tecnico", () => {
    expect(can({ role: "administrador" }, "board.customer")).toBe(true);
    expect(can({ role: "jefe_taller" }, "board.customer")).toBe(true);
    expect(can({ role: "pantalla" }, "board.customer")).toBe(true);
    expect(can({ role: "tecnico" }, "board.customer")).toBe(false);
  });

  it("Pantalla is denied the full board: board.read is for administrador, jefe_taller and tecnico, never pantalla", () => {
    expect(can({ role: "administrador" }, "board.read")).toBe(true);
    expect(can({ role: "jefe_taller" }, "board.read")).toBe(true);
    expect(can({ role: "tecnico" }, "board.read")).toBe(true);
    expect(can({ role: "pantalla" }, "board.read")).toBe(false);
  });

  it("records consent for administrador and jefe_taller, never for tecnico", () => {
    expect(can({ role: "administrador" }, "customers.consent")).toBe(true);
    expect(can({ role: "jefe_taller" }, "customers.consent")).toBe(true);
    expect(can({ role: "tecnico" }, "customers.consent")).toBe(false);
  });

  it("rotates the portal code for administrador only", () => {
    expect(can({ role: "administrador" }, "customers.portalRotate")).toBe(true);
    expect(can({ role: "jefe_taller" }, "customers.portalRotate")).toBe(false);
    expect(can({ role: "tecnico" }, "customers.portalRotate")).toBe(false);
  });

  it("jefe_taller keeps sync.manual and catalogs.generate", () => {
    const user = { id: "j", role: "jefe_taller" as const };
    expect(can(user, "sync.manual")).toBe(true);
    expect(can(user, "catalogs.generate")).toBe(true);
    expect(can(user, "users.manage")).toBe(false);
  });

  it("covers every Role and every Action in the fixtures", () => {
    for (const grants of Object.values(GRANTS_BY_ROLE)) {
      expect(Object.keys(grants).sort()).toEqual([...ACTIONS].sort());
    }
  });

  it("defaults to deny for an unknown role (ghost)", () => {
    const user = { id: "c", role: "ghost" as never };
    for (const action of Object.keys(adminGrants) as Action[]) {
      expect(can(user, action)).toBe(false);
    }
  });
});
