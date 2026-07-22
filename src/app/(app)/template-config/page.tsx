import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { TemplateConfigForm } from "@/modules/template-config/TemplateConfigForm";
import { getTemplateConfig } from "@/modules/template-config/service";

/**
 * R8 — Administrador-only branding config, live preview before save.
 * `proxy.ts` already guarantees a valid session (401); this page adds the
 * role check so the admin-only UI surface isn't rendered to a "usuario" who
 * navigates here directly (the actual persistence action is additionally
 * gated with a real HTTP 403 at `/api/template-config`, see route.ts).
 */
export default async function TemplateConfigPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "template.edit")) {
    return (
      <main>
        <h1>Template configuration</h1>
        <p>You do not have permission to view this page.</p>
      </main>
    );
  }

  const config = await getTemplateConfig();

  return (
    <main>
      <h1>Template configuration</h1>
      <TemplateConfigForm initialConfig={config} />
    </main>
  );
}
