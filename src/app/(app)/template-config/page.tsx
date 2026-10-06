import { can } from "@/modules/auth/policy";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { TemplateConfigForm } from "@/modules/template-config/TemplateConfigForm";
import { getTemplateConfig, listTemplateCoverImages } from "@/modules/template-config/service";
import { getWorkshopConfig } from "@/modules/workshop-config/service";
import { PageHeader } from "@/shared/ui/PageHeader";

/**
 * R8 — Administrador-only template config, with a scaled preview of the
 * catalog the current, UNSAVED choice would produce
 * (workshop-feedback-round-1 PR F1 moved that preview here from the builder,
 * where it could never show a product and rendered at full print size). The
 * branding it draws — logo, cover text, contact — is
 * workshop-owned and read-only here, which is why `getWorkshopConfig` is
 * fetched alongside the template config.
 *
 * `proxy.ts` already guarantees a valid session (401); this page adds the
 * role check so the admin-only UI surface isn't rendered to a "usuario" who
 * navigates here directly (the actual persistence action is additionally
 * gated with a real HTTP 403 at `/api/template-config`, see route.ts).
 */
export default async function TemplateConfigPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "template.edit")) {
    return (
      <PermissionDenied title="Configuración de plantillas" />
    );
  }

  const [config, workshopConfig, coverImages] = await Promise.all([
    getTemplateConfig(),
    getWorkshopConfig(),
    listTemplateCoverImages(),
  ]);
  // Plain strings only: this crosses into a "use client" form.
  const coverImageKeys = Object.fromEntries(coverImages.map((row) => [row.templateId, row.r2Key]));

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Configuración de plantillas" />
      <TemplateConfigForm initialConfig={config} workshopConfig={workshopConfig} coverImageKeys={coverImageKeys} />
    </div>
  );
}
