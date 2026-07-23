"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Client boundary scoped to this single component (same pattern as
 * `NavItem`) — `fetch` + `useRouter().push()` are the only reasons this
 * piece of the Sidebar needs to run in the browser.
 *
 * Icon-only (confirmed mockup): `aria-label`/`title` carry the accessible
 * name since the "Cerrar sesión" text label is gone.
 */
export function LogoutButton() {
  const router = useRouter();

  async function handleClick() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg text-dash-red transition-colors hover:bg-dash-red/10"
    >
      <LogOut aria-hidden="true" size={20} />
    </button>
  );
}
