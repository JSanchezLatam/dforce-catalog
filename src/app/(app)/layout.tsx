import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getNavItems } from "@/modules/layout/nav-items";
import { ToastProvider } from "@/shared/ui/ToastProvider";

/**
 * Route group — does not affect the URL path (/inventory, /builder,
 * /catalogs, /template-config keep working identically), only which pages
 * get the sidebar shell. `/login` and the root `/` redirect live outside
 * this group and render with no sidebar (design.md).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionFromHeaders();
  const navItems = getNavItems(user);

  return (
    <ToastProvider>
      <SidebarProvider>
        <AppSidebar navItems={navItems} user={user} />
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
    </ToastProvider>
  );
}
