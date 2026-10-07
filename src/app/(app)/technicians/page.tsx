import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { listRoster, listTecnicoLogins } from "@/modules/technicians/queries";
import { TechnicianRoster } from "@/modules/technicians/TechnicianRoster";
import { PageHeader } from "@/shared/ui/PageHeader";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

/**
 * Thin RSC wrapper (mirrors `users/page.tsx`): authorize, fetch, hand plain data
 * to the client roster. Every row is fetched and the client filters inactive ones
 * locally. Linking a login is `users.manage`: a jefe never receives the login list.
 */
export default async function TechniciansPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "technicians.manage")) {
    return <PermissionDenied title="Técnicos" />;
  }

  const canLink = can(user, "users.manage");
  const [roster, logins] = await Promise.all([listRoster(), canLink ? listTecnicoLogins() : Promise.resolve([])]);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Técnicos" />
      <TechnicianRoster
        // Named columns, not a spread: `createdAt` is a Date the roster never
        // renders, and a Date does not survive the RSC boundary as one.
        technicians={roster.map((t) => ({
          id: t.id,
          nombre: t.nombre,
          userId: t.userId,
          username: t.username,
          deactivatedAt: t.deactivatedAt?.toISOString() ?? null,
        }))}
        logins={logins}
        canLink={canLink}
      />
    </div>
  );
}
