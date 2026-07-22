"use client";

import { useRouter } from "next/navigation";

/**
 * Client boundary scoped to this single component (same pattern as
 * `NavItem`) — `fetch` + `useRouter().push()` are the only reasons this
 * piece of the Sidebar needs to run in the browser.
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
      className="p-4 text-left text-sm text-dash-red hover:bg-dash-red/10"
    >
      Cerrar sesión
    </button>
  );
}
