import { cookies } from "next/headers";

import { AppSidebar } from "@/components/app-sidebar";
import { SIDEBAR_COOKIE_NAME, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getNavBadges } from "@/modules/layout/nav-badges";
import { getNavGroups } from "@/modules/layout/nav-items";
import { decodeNavCollapseState, NAV_COLLAPSE_COOKIE_NAME } from "@/modules/layout/nav-collapse-state";
import { getUserProfile } from "@/modules/account/queries";
import { getWorkshopConfig } from "@/modules/workshop-config/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionFromHeaders();
  // Same `getDueVencimientos` call the page renders its rows from, so the badge
  // equals the row count. Empty for a viewer without `vencimientos.read`.
  const navGroups = getNavGroups(user, await getNavBadges(user));
  const profile = await getUserProfile(user.id);
  const config = await getWorkshopConfig();

  const cookieStore = await cookies();
  // Fixes a latent bug: the rail cookie was written on every toggle but
  // never read back, so the sidebar always reset to open on reload.
  const sidebarCookie = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value;
  const sidebarDefaultOpen = sidebarCookie === undefined ? true : sidebarCookie === "true";
  const initialCollapseState = decodeNavCollapseState(cookieStore.get(NAV_COLLAPSE_COOKIE_NAME)?.value);

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <AppSidebar
        navGroups={navGroups}
        user={{ id: user.id, role: user.role, name: profile?.name, username: profile?.username }}
        workshopName={config?.name ?? null}
        logoR2Key={config?.logoR2Key ?? null}
        initialCollapseState={initialCollapseState}
      />
      <SidebarInset>
        {/* Below `lg` the sidebar is an off-canvas Sheet with no other way to open
            it, so phones get this bar. `aria-label` replaces shadcn's English
            sr-only "Toggle Sidebar"; `min-h-11 min-w-11` is the 44x44 rule. */}
        <header className="flex items-center gap-2 border-b px-2 py-1 lg:hidden print:hidden">
          <SidebarTrigger aria-label="Abrir menú" className="min-h-11 min-w-11" />
          {config?.name && <span className="truncate font-medium">{config.name}</span>}
        </header>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            {/* `print:py-0 print:gap-0` — this wrapper is outside the print page's own
                `print:p-0`, so its vertical padding stacked on top of `@page`'s
                12mm margin and pushed the sheet down the paper. It is also the
                `flex flex-col` that makes the sheet a flex item, which is why
                `globals.css`'s print rules need `w-full` and not only
                `max-w-none` — the reason is recorded there. */}
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 print:gap-0 print:py-0">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
