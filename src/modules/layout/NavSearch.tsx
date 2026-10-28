"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"

import { Input } from "@/components/ui/input"

/**
 * Controlled menu search box. `firstHref` is the first link of the already
 * filtered list, so Enter lands where the list says it will.
 * The input is `type="text"`: the native clear button of `type="search"` would collide with the "/" chip.
 */
export function NavSearch({
  query,
  onQueryChange,
  firstHref,
}: {
  query: string
  onQueryChange: (query: string) => void
  firstHref: string | undefined
}) {
  const router = useRouter()

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      onQueryChange("")
    } else if (e.key === "Enter" && firstHref) {
      router.push(firstHref)
      onQueryChange("")
    }
  }

  return (
    <div role="search" className="relative mx-2 mb-2">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        autoComplete="off"
        aria-label="Buscar en el menú"
        placeholder="Buscar…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="bg-background pr-9 pl-8 pointer-coarse:text-base dark:bg-background"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 grid h-5 min-w-5 -translate-y-1/2 place-items-center rounded-sm border border-sidebar-border bg-sidebar-accent px-1 font-mono text-[11px] text-muted-foreground pointer-coarse:hidden"
      >
        /
      </kbd>
    </div>
  )
}
