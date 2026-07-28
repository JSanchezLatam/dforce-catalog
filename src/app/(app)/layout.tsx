import { cookies } from "next/headers";

import { AppSidebar } from "@/components/app-sidebar";
import { SIDEBAR_COOKIE_NAME, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getNavGroups } from "@/modules/layout/nav-items";
import { decodeNavCollapseState, NAV_COLLAPSE_COOKIE_NAME } from "@/modules/layout/nav-collapse-state";
import { getUserProfile } from "@/modules/account/queries";
import { getWorkshopConfig } from "@/modules/workshop-config/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionFromHeaders();
  const navGroups = getNavGroups(user);
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
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
