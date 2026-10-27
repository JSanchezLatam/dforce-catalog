import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { PageHeader } from "@/shared/ui/PageHeader";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

/** Stub: authorizes and renders the heading. The agenda reads arrive in later work units. */
export default async function AgendaPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "agenda.manage")) {
    return <PermissionDenied title="Agenda" />;
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Agenda" />
    </div>
  );
}
