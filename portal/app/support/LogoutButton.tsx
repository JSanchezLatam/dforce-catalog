"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState(false);

  const logout = async () => {
    setError(false);
    try {
      const res = await fetch("/api/support/logout", { method: "POST" });
      // 401 means the session is already gone: the login page is where they belong either way.
      if (!res.ok && res.status !== 401) throw new Error(String(res.status));
      router.replace("/support/login");
      router.refresh();
    } catch {
      setError(true);
    }
  };

  return (
    <div className="logout">
      {error && (
        <span className="error" role="alert">
          No se pudo cerrar la sesión. Probá de nuevo.
        </span>
      )}
      <button type="button" className="btn ghost" onClick={logout}>
        Salir
      </button>
    </div>
  );
}
