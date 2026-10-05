import { can } from "@/modules/auth/policy";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listUsers } from "@/modules/account/queries";
import { UserFormTrigger } from "@/modules/account/UserFormTrigger";
import { UsersTable } from "@/modules/account/UsersTable";
import { PageHeader } from "@/shared/ui/PageHeader";

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
      <PermissionDenied title="Gestión de usuarios" />
    );
  }

  const users = await listUsers({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Gestión de usuarios" actions={<UserFormTrigger />} />
      <UsersTable
        // Dates do not survive the RSC boundary as Date instances — serialise
        // here so the client component's prop type is honest about what it gets.
        users={users.map((u) => ({ ...u, deactivatedAt: u.deactivatedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
