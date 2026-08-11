import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listUsers } from "@/modules/account/queries";
import { UsersTable } from "@/modules/account/UsersTable";
import { PAGE_HEADING } from "@/shared/ui/styles";

/**
 * Thin RSC wrapper (mirrors `customers/page.tsx`): fetch, authorize, hand
 * props to the client component.
 *
 * Fetches with `includeInactive: true` and lets `UsersTable` filter locally —
 * a workshop has a handful of users, so one query beats a refetch every time
 * the "Mostrar inactivos" toggle flips.
 */
export default async function UsersPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "users.manage")) {
    return (
      <div className="p-8">
        <h1 className={PAGE_HEADING}>Gestión de usuarios</h1>
        <p className="text-sm text-foreground">No tienes permiso para ver esta página.</p>
      </div>
    );
  }

  const users = await listUsers({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6 p-8">
      <h1 className={PAGE_HEADING}>Gestión de usuarios</h1>
      <UsersTable
        // Dates do not survive the RSC boundary as Date instances — serialise
        // here so the client component's prop type is honest about what it gets.
        users={users.map((u) => ({ ...u, deactivatedAt: u.deactivatedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
