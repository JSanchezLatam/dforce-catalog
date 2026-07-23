import type { SessionUser } from "@/modules/auth/session";

import { LogoSlot } from "./LogoSlot";
import { LogoutButton } from "./LogoutButton";
import { getNavItems } from "./nav-items";
import { NavItem } from "./NavItem";

/**
 * Confirmed mockup layout: `justify-between` on the flex column with exactly
 * two direct children (TopGroup, LogoutBtn) puts the logout button flush to
 * the bottom without a flex-grow spacer (empirically the reliable approach —
 * see design.md).
 */
export function Sidebar({ user }: { user: SessionUser }) {
  const navItems = getNavItems(user);

  return (
    <aside className="flex h-screen w-[72px] shrink-0 flex-col justify-between bg-dash-card">
      <div>
        <LogoSlot />
        <hr className="border-dash-border" />
        <nav className="flex flex-col gap-2 py-4">
          {navItems.map((item) => (
            <NavItem key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>
      </div>
      <LogoutButton />
    </aside>
  );
}
