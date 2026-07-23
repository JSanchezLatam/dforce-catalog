import { can } from "@/modules/auth/policy";
import type { SessionUser } from "@/modules/auth/session";

// ponytail: icon *key*, not the lucide-react component itself — `Sidebar`
// (server component) can't hand a component/function reference to `NavItem`
// (client component) across the RSC boundary (React throws "Functions cannot
// be passed directly to Client Components"). `NavItem` resolves the key to
// the real icon locally instead.
export type NavIconKey = "inventory" | "builder" | "catalogs" | "template-config";
export type NavLink = { href: string; label: string; icon: NavIconKey };

// Sync stays embedded in /inventory (ManualSyncButton) — not a nav item (design.md).
const BASE_NAV_ITEMS: NavLink[] = [
  { href: "/inventory", label: "Inventario", icon: "inventory" },
  { href: "/builder", label: "Generar Catálogo", icon: "builder" },
  { href: "/catalogs", label: "Catálogos", icon: "catalogs" },
];

const TEMPLATE_CONFIG_ITEM: NavLink = {
  href: "/template-config",
  label: "Configuración de Template",
  icon: "template-config",
};

/**
 * Sidebar's only real conditional logic — reuses the existing `can()` policy
 * seam so "Configuración de Template" is absent from the array entirely for
 * non-admins (not rendered-then-hidden via CSS).
 */
export function getNavItems(user: SessionUser): NavLink[] {
  return can(user, "template.edit") ? [...BASE_NAV_ITEMS, TEMPLATE_CONFIG_ITEM] : BASE_NAV_ITEMS;
}
