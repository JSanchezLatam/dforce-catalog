"use client"
import { LogOut, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

export function LogoutButton() {
  const [status, setStatus] = useState<"idle" | "submitting">("idle")
  const router = useRouter()

  async function handleLogout() {
    setStatus("submitting")
    try {
      await fetch("/api/logout", { method: "POST" })
      router.push("/login")
    } catch {
      setStatus("idle")
    }
  }

  return (
    <DropdownMenuItem onClick={handleLogout} disabled={status === "submitting"} className="text-destructive">
      {status === "submitting" ? <Loader2 className="animate-spin" /> : <LogOut />}
      <span>Cerrar sesión</span>
    </DropdownMenuItem>
  )
}
