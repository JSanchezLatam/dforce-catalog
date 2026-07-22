import { requireSessionFromHeaders } from "@/modules/auth/session";
import { Sidebar } from "@/modules/layout/Sidebar";

/**
 * Route group — does not affect the URL path (/inventory, /builder,
 * /catalogs, /template-config keep working identically), only which pages
 * get the sidebar shell. `/login` and the root `/` redirect live outside
 * this group and render with no sidebar (design.md).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionFromHeaders();

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
