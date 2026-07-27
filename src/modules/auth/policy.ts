export const ACTIONS = [
  "customers.read",
  "customers.write",
  "service-orders.read",
  "service-orders.write",
  "inventory.read",
  "catalogs.read",
  "catalogs.download",
  "catalogs.generate",
  "catalogs.listAll",
  "template.edit",
  "workshop.read",
  "workshop.edit",
  "users.manage",
  "sync.manual",
  "account.self",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Grants = { readonly [A in Action]: boolean };

export const MATRIX: { readonly [R in "tecnico" | "administrador"]: Grants } = {
  tecnico: {
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
    "workshop.read": true,
    "workshop.edit": false,
    "users.manage": false,
    "sync.manual": false,
    "account.self": true,
  },
  administrador: {
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
    "workshop.read": true,
    "workshop.edit": true,
    "users.manage": true,
    "sync.manual": true,
    "account.self": true,
  },
};

export function can(user: { role: string }, action: Action): boolean {
  const grants = MATRIX[user.role as keyof typeof MATRIX];
  if (!grants) return false;
  return grants[action];
}
