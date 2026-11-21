import { can } from "@/modules/auth/policy";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listUsers } from "@/modules/account/queries";
import { userAccessFacts } from "@/modules/auth/access-facts";
import { requiresTwoFactor } from "@/modules/auth/enrolment";
import type { Role } from "@/modules/auth/roles";
import { userLocks } from "@/modules/auth/login-attempts";
import { UserFormTrigger } from "@/modules/account/UserFormTrigger";
import { UsersTable } from "@/modules/account/UsersTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { formatDateTime } from "@/shared/datetime";

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
  const locks = await userLocks(users.map((u) => u.username));
  const facts = await userAccessFacts(users.map((u) => u.id));

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Gestión de usuarios" actions={<UserFormTrigger />} />
      <UsersTable
        // Dates do not survive the RSC boundary as Date instances — serialise
        // here so the client component's prop type is honest about what it gets.
        users={users.map((u) => ({
          ...u,
          deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
          lockedUntil: locks.get(u.username)?.toISOString() ?? null,
          twoFactor: facts.get(u.id)?.twoFactor ?? null,
          twoFactorRequired: requiresTwoFactor(u.role as Role),
          // Formatted here, not in the client table: the browser's ICU and Node's differ
          // in the space before "p. m.", which is a hydration mismatch.
          lastAccess: formatDateTime(facts.get(u.id)?.lastAccessAt ?? null),
        }))}
        currentUserId={user.id}
      />
    </div>
  );
}
