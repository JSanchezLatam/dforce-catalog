import { can } from "@/modules/auth/policy";
import type { SessionUser } from "@/modules/auth/session";

export type NavLink = { href: string; label: string };

// Sync stays embedded in /inventory (ManualSyncButton) — not a nav item (design.md).
const BASE_NAV_ITEMS: NavLink[] = [
  { href: "/inventory", label: "Inventario" },
  { href: "/builder", label: "Generar Catálogo" },
  { href: "/catalogs", label: "Catálogos" },
];

const TEMPLATE_CONFIG_ITEM: NavLink = { href: "/template-config", label: "Configuración de Template" };

/**
 * Sidebar's only real conditional logic — reuses the existing `can()` policy
 * seam so "Configuración de Template" is absent from the array entirely for
 * non-admins (not rendered-then-hidden via CSS).
 */
export function getNavItems(user: SessionUser): NavLink[] {
  return can(user, "template.edit") ? [...BASE_NAV_ITEMS, TEMPLATE_CONFIG_ITEM] : BASE_NAV_ITEMS;
}
