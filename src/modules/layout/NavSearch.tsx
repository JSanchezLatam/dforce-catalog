"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Input } from "@/components/ui/input"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

/**
 * Controlled menu search box. `firstHref` is the first link of the already
 * filtered list, so Enter lands where the list says it will.
 * In the rail the box is hidden and a search icon expands the sidebar, then focuses the box.
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
  const { state, setOpen, isMobile, openMobile } = useSidebar()
  const inputRef = React.useRef<HTMLInputElement>(null)
  // The input is hidden until the rail's width transition starts, so focus waits for the expanded state.
  const focusPending = React.useRef(false)
  const inRail = state === "collapsed" && !isMobile

  function focusBox() {
    if (inRail) {
      focusPending.current = true
      setOpen(true)
    } else {
      inputRef.current?.focus()
    }
  }

  React.useEffect(() => {
    if (state === "expanded" && focusPending.current) {
      focusPending.current = false
      inputRef.current?.focus()
    }
  }, [state])

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return
      if (isMobile && !openMobile) return
      // jsdom has no `isContentEditable`, so `closest` is what its tests (and nested editors) rely on.
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('[contenteditable]:not([contenteditable="false"])') || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      e.preventDefault()
      focusBox()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      onQueryChange("")
    } else if (e.key === "Enter" && firstHref) {
      router.push(firstHref)
      onQueryChange("")
    }
  }

  return (
    <>
    <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Buscar" aria-label="Buscar en el menú" onClick={focusBox}>
          <Search />
          <span>Buscar</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
    <div role="search" className="relative mx-2 mb-2 group-data-[collapsible=icon]:hidden">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
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
    </>
  )
}
