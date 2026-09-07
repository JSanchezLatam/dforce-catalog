"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function LoginThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // `mounted` is NOT redundant with the `!resolvedTheme` gate here, even though
  // the sidebar's ThemeToggle drops it. That one only ever renders inside an
  // opened dropdown, so it is never server-rendered and never hydrated. This
  // one is a direct child of a Server Component: the server returns null, but
  // next-themes resolves the stored theme during the client's FIRST render, so
  // without `mounted` the client emits the button where the server emitted
  // nothing — a hydration mismatch, confirmed in the browser. `mounted` forces
  // the hydration render to match the server, and the button appears after.
  if (!mounted || !resolvedTheme) return null;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="fixed right-5 top-5 z-10 inline-flex h-11 items-center gap-2.5 rounded-full border border-border bg-card pl-3.5 pr-4 text-[13px] font-semibold text-card-foreground shadow-[0_10px_30px_rgb(0_0_0_/_0.12)] transition-all hover:-translate-y-px hover:shadow-[0_14px_34px_rgb(0_0_0_/_0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
    >
      {isDark ? (
        <Sun className="size-[18px] text-[var(--login-brand)]" aria-hidden="true" />
      ) : (
        <Moon className="size-[18px] text-[var(--login-brand)]" aria-hidden="true" />
      )}
      <span>{isDark ? "Modo claro" : "Modo oscuro"}</span>
    </button>
  );
}
