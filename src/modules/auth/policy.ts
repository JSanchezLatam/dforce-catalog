import type { Role } from "./roles";

export const ACTIONS = [
  "customers.read",
  "customers.write",
  "customers.deleteVehicle",
  "vencimientos.read",
  "vencimientos.contact",
  "service-orders.read",
  "service-orders.write",
  "service-orders.deletePhoto",
  "service-orders.correct",
  "service-orders.readAll",
  "service-orders.create",
  "service-orders.assign",
  "inventory.read",
  "catalogs.read",
  "catalogs.download",
  "catalogs.generate",
  "catalogs.listAll",
  "template.edit",
  "workshop.read",
  "workshop.edit",
  "users.manage",
  "technicians.manage",
  "sync.manual",
  "account.self",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Grants = { readonly [A in Action]: boolean };

export const MATRIX: Record<Role, Grants> = {
  tecnico: {
    "customers.read": true,
    "customers.write": true,
    "customers.deleteVehicle": false,
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
    // A catalog is a workshop asset, not a personal document — the owner's
    // decision, 2026-09-15. Without this, `catalogs.read` and
    // `catalogs.download` above were dead grants: `catalogs/page.tsx` scopes
    // the list to `userId` when `listAll` is false, and a técnico cannot
    // `generate`, so their screen was empty by construction and those two
    // `true`s did nothing. Generation stays administrador-only.
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
  },
  // The workshop manager: everything the owner holds except user management,
  // workshop and template settings, and closed-order corrections.
  jefe_taller: {
    "customers.read": true,
    "customers.write": true,
    "customers.deleteVehicle": true,
    "vencimientos.read": true,
    "vencimientos.contact": true,
    "service-orders.read": true,
    "service-orders.write": true,
    "service-orders.deletePhoto": true,
    "service-orders.correct": false,
    "service-orders.readAll": true,
    "service-orders.create": true,
    "service-orders.assign": true,
    "inventory.read": true,
    "catalogs.read": true,
    "catalogs.download": true,
    "catalogs.generate": true,
    "catalogs.listAll": true,
    "template.edit": false,
    "workshop.read": true,
    "workshop.edit": false,
    "users.manage": false,
    "technicians.manage": true,
    "sync.manual": true,
    "account.self": true,
  },
  administrador: {
    "customers.read": true,
    "customers.write": true,
    "customers.deleteVehicle": true,
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
  },
};

export function can(user: { role: string }, action: Action): boolean {
  const grants = MATRIX[user.role as keyof typeof MATRIX];
  if (!grants) return false;
  return grants[action];
}
