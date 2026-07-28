"use client"

import * as React from "react"
import { FileSpreadsheet, Package, BookOpen, Settings, GalleryVerticalEnd, ChevronDown, ChevronRight, Users, Wrench, User } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogoutButton } from "@/modules/layout/LogoutButton"
import { ThemeToggle } from "@/modules/layout/ThemeToggle"
import { WorkshopLogo } from "./WorkshopLogo"
import { ROLE_LABELS } from "@/modules/auth/roles"
import type { NavGroup, NavLink, NavParent } from "@/modules/layout/nav-items"
import {
  decodeNavCollapseState,
  encodeNavCollapseState,
  extractCookieValue,
  getGroupOpen,
  NAV_COLLAPSE_COOKIE_MAX_AGE,
  NAV_COLLAPSE_COOKIE_NAME,
  type NavCollapseState,
} from "@/modules/layout/nav-collapse-state"

const ICON_MAP: Record<string, typeof Package> = {
  inventory: Package,
  builder: FileSpreadsheet,
  catalogs: BookOpen,
  "template-config": Settings,
  customers: Users,
  "service-orders": Wrench,
}

function NavLinkItem({ item }: { item: NavLink }) {
  const pathname = usePathname()
  const Icon = ICON_MAP[item.icon] || Package
  const isActive = pathname.startsWith(item.href)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive} tooltip={item.label}>
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function NavParentExpanded({
  parent,
  open,
  onOpenChange,
}: {
  parent: NavParent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const Icon = ICON_MAP[parent.icon] || Package

  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger render={<SidebarMenuButton tooltip={parent.label} />} className="w-full cursor-pointer">
          <Icon aria-hidden="true" />
          <span>{parent.label}</span>
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 transition-transform duration-200 ease-linear motion-reduce:transition-none data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {parent.children.map((child) => {
              const ChildIcon = ICON_MAP[child.icon] || Package
              return (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton render={<Link href={child.href} />}>
                    <ChildIcon />
                    <span>{child.label}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

function NavParentCollapsed({ parent }: { parent: NavParent }) {
  const pathname = usePathname()
  const Icon = ICON_MAP[parent.icon] || Package

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <SidebarMenuButton tooltip={parent.label} className="cursor-pointer">
            <Icon />
            <span>{parent.label}</span>
            <ChevronRight className="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-48 rounded-xl">
          {parent.children.map((child) => {
            const ChildIcon = ICON_MAP[child.icon] || Package
            return (
              <DropdownMenuItem key={child.href}>
                <Link href={child.href} className={`flex items-center gap-2 ${pathname.startsWith(child.href) ? "font-semibold" : ""}`}>
                  <ChildIcon className="size-4" />
                  <span>{child.label}</span>
                </Link>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function NavGroupSection({
  group,
  collapsed,
  collapseState,
  onToggleGroup,
}: {
  group: NavGroup
  collapsed: boolean
  collapseState: NavCollapseState
  onToggleGroup: (id: string, open: boolean) => void
}) {
  const labelId = React.useId()

  function renderItems() {
    return group.items.map((item) => {
      if (item.kind === "parent") {
        return collapsed ? (
          <NavParentCollapsed key={item.id} parent={item} />
        ) : (
          <NavParentExpanded
            key={item.id}
            parent={item}
            open={getGroupOpen(collapseState, item.id)}
            onOpenChange={(open) => onToggleGroup(item.id, open)}
          />
        )
      }
      return <NavLinkItem key={item.href} item={item} />
    })
  }

  // Icon-rail mode: the group header is not rendered as an interactive
  // trigger at all. Its persisted collapsed state is ignored so the
  // group's icons stay visible — a saved "closed" group must not hide an
  // entire icon column once the sidebar itself rail-collapses. This also
  // avoids leaving an invisible-but-focusable button in the DOM (the
  // label is only visually hidden by CSS in `sidebar.tsx`, not removed).
  if (collapsed) {
    return (
      <SidebarGroup className={group.pinBottom ? "mt-auto" : ""} role="group" aria-labelledby={labelId}>
        <SidebarGroupLabel id={labelId}>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>{renderItems()}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  const open = getGroupOpen(collapseState, group.id)

  return (
    <SidebarGroup className={group.pinBottom ? "mt-auto" : ""} role="group" aria-labelledby={labelId}>
      <Collapsible open={open} onOpenChange={(next) => onToggleGroup(group.id, next)}>
        <CollapsibleTrigger
          id={labelId}
          render={<SidebarGroupLabel render={<button type="button" />} />}
          className="w-full cursor-pointer justify-between gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span>{group.label}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform duration-200 ease-linear motion-reduce:transition-none data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems()}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  )
}

export function AppSidebar({
  navGroups,
  user,
  workshopName,
  logoR2Key,
  initialCollapseState,
}: {
  navGroups: NavGroup[]
  user: { id: string; role: string; name?: string | null; username?: string }
  workshopName: string | null
  logoR2Key: string | null
  initialCollapseState: NavCollapseState
}) {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  // Lifted so every group/parent collapsible writes into the SAME
  // `sidebar_group_state` cookie value without clobbering each other's
  // saved state — each key toggles independently (not an accordion).
  const [collapseState, setCollapseState] = React.useState<NavCollapseState>(initialCollapseState)

  const handleToggleGroup = React.useCallback((id: string, open: boolean) => {
    // Re-read the cookie right before writing (rather than trusting a
    // possibly-stale React closure) so a second tab that toggled a
    // different group in the meantime doesn't get silently clobbered.
    const current = decodeNavCollapseState(extractCookieValue(document.cookie, NAV_COLLAPSE_COOKIE_NAME))
    const next: NavCollapseState = { ...current, [id]: open }
    document.cookie = `${NAV_COLLAPSE_COOKIE_NAME}=${encodeNavCollapseState(next)}; path=/; max-age=${NAV_COLLAPSE_COOKIE_MAX_AGE}`
    setCollapseState(next)
  }, [])

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/inventory" />}>
              <WorkshopLogo logoR2Key={logoR2Key} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{workshopName ?? "Dforce"}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group, i) => (
          <React.Fragment key={group.id}>
            {i > 0 && <SidebarSeparator />}
            <NavGroupSection
              group={group}
              collapsed={collapsed}
              collapseState={collapseState}
              onToggleGroup={handleToggleGroup}
            />
          </React.Fragment>
        ))}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="group/trigger w-full">
                <SidebarMenuButton size="lg" className="w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg text-xs font-bold bg-sidebar-primary text-sidebar-primary-foreground">
                      {(user.name ?? user.username ?? user.role).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user.name ?? user.username ?? user.role}</span>
                    <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}</span>
                  </div>
                  <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-180" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" className="w-48 rounded-xl" align="start">
                <DropdownMenuItem>
                  <Link href="/account" className="flex items-center gap-2">
                    <User className="size-4" />
                    <span>Mi cuenta</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <ThemeToggle />
                <DropdownMenuSeparator />
                <LogoutButton />
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
