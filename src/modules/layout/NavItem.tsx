"use client";

import { BookOpen, FileSpreadsheet, Package, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavIconKey, NavLink } from "./nav-items";

// ponytail: hardcoded icon-key → lucide component map for 4 items — no
// generic icon-registry needed. Resolved here (client-side) since
// `nav-items.ts` only carries a serializable string key across the RSC
// boundary, not the component reference itself.
const ICONS: Record<NavIconKey, typeof Package> = {
  inventory: Package,
  builder: FileSpreadsheet,
  catalogs: BookOpen,
  "template-config": Settings,
};

/**
 * Client boundary is scoped to this single component — `usePathname()` is
 * the only reason this piece of the Sidebar needs to run in the browser
 * (see `LogoutButton` for the other scoped client boundary).
 *
 * Icon-only rail (confirmed mockup): the icon itself is decorative
 * (`aria-hidden`) — the accessible name lives on the `<Link>` via
 * `aria-label`/`title` since there is no visible text label anymore.
 */
export function NavItem({ href, label, icon }: NavLink) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname?.startsWith(`${href}/`);
  const Icon = ICONS[icon];

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`mx-auto flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
        isActive
          ? "bg-dash-purple text-dash-fg"
          : "text-dash-muted hover:bg-dash-purple/20 hover:text-dash-fg"
      }`}
    >
      <Icon aria-hidden="true" size={20} />
    </Link>
  );
}
