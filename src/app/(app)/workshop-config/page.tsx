import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { WorkshopConfigForm } from "@/modules/workshop-config/WorkshopConfigForm";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { PAGE_HEADING } from "@/shared/ui/styles";

export default async function WorkshopConfigPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "workshop.edit")) {
    return (
      <div className="p-8">
        <h1 className={PAGE_HEADING}>Configuración del CRM</h1>
        <p className="text-sm text-foreground">No tenés permiso para ver esta página.</p>
      </div>
    );
  }

  const config = await getWorkshopConfig();

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Configuración del CRM</h1>
      <WorkshopConfigForm initialConfig={config} />
    </div>
  );
}
