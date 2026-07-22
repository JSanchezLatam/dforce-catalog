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
    <aside className="flex h-screen w-[200px] shrink-0 flex-col justify-between bg-dragon-sidebar-bg">
      <div>
        <LogoSlot />
        <hr className="border-dragon-muted" />
        <nav className="flex flex-col py-2">
          {navItems.map((item) => (
            <NavItem key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
      </div>
      <LogoutButton />
    </aside>
  );
}
