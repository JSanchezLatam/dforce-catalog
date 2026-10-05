import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { WorkshopConfigForm } from "@/modules/workshop-config/WorkshopConfigForm";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { PageHeader } from "@/shared/ui/PageHeader";

export default async function WorkshopConfigPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "workshop.edit")) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title="Configuración del CRM" />
        <p className="text-sm text-foreground">No tenés permiso para ver esta página.</p>
      </div>
    );
  }

  const config = await getWorkshopConfig();

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Configuración del CRM" />
      <WorkshopConfigForm initialConfig={config} />
    </div>
  );
}
