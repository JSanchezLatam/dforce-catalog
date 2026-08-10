import { can, type Action } from "@/modules/auth/policy";
import type { SessionUser } from "@/modules/auth/session";

export type NavIconKey = "inventory" | "builder" | "catalogs" | "template-config" | "customers" | "service-orders" | "users";

export type NavLink = { kind: "link"; href: string; label: string; icon: NavIconKey; action?: Action };

export type NavParent = { kind: "parent"; id: string; label: string; icon: NavIconKey; children: NavLink[]; action?: Action };

export type NavGroup = {
  id: string;
  label: string;
  items: (NavLink | NavParent)[];
  pinBottom?: boolean;
};

const CRM_ITEMS: (NavLink | NavParent)[] = [
  { kind: "link", href: "/customers", label: "Clientes", icon: "customers", action: "customers.read" },
  { kind: "link", href: "/service-orders", label: "Órdenes de servicio", icon: "service-orders", action: "service-orders.read" },
  { kind: "link", href: "/inventory", label: "Inventario", icon: "inventory", action: "inventory.read" },
];

const CATALOGO_ITEMS: (NavLink | NavParent)[] = [
  { kind: "link", href: "/builder", label: "Generar Catálogos", icon: "builder", action: "catalogs.generate" },
  { kind: "link", href: "/catalogs", label: "Catálogos Generados", icon: "catalogs", action: "catalogs.read" },
];

const CONFIGURACION_ITEMS: (NavLink | NavParent)[] = [
  { kind: "link", href: "/workshop-config", label: "Config. del CRM", icon: "template-config", action: "workshop.edit" },
  {
    kind: "parent",
    id: "config-catalogos",
    label: "Config. de catálogos",
    icon: "template-config",
    action: "template.edit",
    children: [
      { kind: "link", href: "/template-config", label: "Configuración de template", icon: "template-config", action: "template.edit" },
    ],
  },
  // Gated on the same `users.manage` action that /users and /api/users
  // enforce, so the link can never render for someone who would get a 403 on
  // arrival. Its own icon key — reusing `customers` (the Clientes icon) would
  // put the same glyph on two unrelated entries.
  { kind: "link", href: "/users", label: "Gestión de usuarios", icon: "users", action: "users.manage" },
];

const GROUPS: NavGroup[] = [
  { id: "crm", label: "CRM", items: CRM_ITEMS },
  { id: "catalogo", label: "Catálogo", items: CATALOGO_ITEMS },
  { id: "configuracion", label: "Configuración", items: CONFIGURACION_ITEMS, pinBottom: true },
];

function itemVisible(user: SessionUser, item: NavLink | NavParent): boolean {
  if (!item.action) return true;
  return can(user, item.action);
}

function filterItem(user: SessionUser, item: NavLink | NavParent): NavLink | NavParent | null {
  if (!itemVisible(user, item)) return null;
  if (item.kind === "parent") {
    const visible = item.children.filter((c) => itemVisible(user, c));
    if (visible.length === 0) return null;
    return { ...item, children: visible };
  }
  return item;
}

export function getNavGroups(user: SessionUser): NavGroup[] {
  const result: NavGroup[] = [];
  for (const group of GROUPS) {
    const items = group.items.map((item) => filterItem(user, item)).filter((i): i is NavLink | NavParent => i !== null);
    if (items.length > 0) result.push({ ...group, items });
  }
  return result;
}
