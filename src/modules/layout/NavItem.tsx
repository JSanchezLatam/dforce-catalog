"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavLink } from "./nav-items";

/**
 * Client boundary is scoped to this single component — `usePathname()` is
 * the only reason any part of the Sidebar needs to run in the browser.
 */
export function NavItem({ href, label }: NavLink) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`block px-4 py-2 text-sm ${isActive ? "bg-dragon-blue" : "hover:bg-dragon-blue/20"}`}
    >
      {label}
    </Link>
  );
}
