"use client"

import { Fragment } from "react"
import { FileSpreadsheet, Package, BookOpen, Settings, GalleryVerticalEnd, ChevronDown, ChevronRight, Users, Wrench } from "lucide-react"
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

function NavParentExpanded({ parent }: { parent: NavParent }) {
  const Icon = ICON_MAP[parent.icon] || Package

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={parent.label}>
        <Icon />
        <span>{parent.label}</span>
        <ChevronDown className="ml-auto" />
      </SidebarMenuButton>
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

function NavGroupSection({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  return (
    <SidebarGroup className={group.pinBottom ? "mt-auto" : ""}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            if (item.kind === "parent") {
              return collapsed ? <NavParentCollapsed key={item.label} parent={item} /> : <NavParentExpanded key={item.label} parent={item} />
            }
            return <NavLinkItem key={item.href} item={item} />
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({
  navGroups,
  user,
  workshopName,
  logoR2Key,
}: {
  navGroups: NavGroup[]
  user: { id: string; role: string; name?: string | null; username?: string }
  workshopName: string | null
  logoR2Key: string | null
}) {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

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
          <Fragment key={group.label}>
            {i > 0 && <SidebarSeparator />}
            <NavGroupSection group={group} collapsed={collapsed} />
          </Fragment>
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
