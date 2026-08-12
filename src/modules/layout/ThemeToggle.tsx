"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // `resolvedTheme` is undefined on the server and until next-themes reads the
  // stored preference on the client — which is exactly what the old `mounted`
  // state was standing in for. Gating on it directly drops both the state and
  // the effect, and renders nothing until we know which icon is correct
  // instead of guessing and swapping.
  if (!resolvedTheme) return null

  const isDark = resolvedTheme === "dark"

  return (
    <DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? <Sun /> : <Moon />}
      <span>{isDark ? "Modo claro" : "Modo oscuro"}</span>
    </DropdownMenuItem>
  )
}
