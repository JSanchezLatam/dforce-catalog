import { can } from "@/modules/auth/policy";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getUserProfile } from "@/modules/account/queries";
import { ProfileForm } from "@/modules/account/ProfileForm";
import { PasswordForm } from "@/modules/account/PasswordForm";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ROLE_LABELS } from "@/modules/auth/roles";

export default async function AccountPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "account.self")) {
    return (
      <PermissionDenied title="Mi cuenta" />
    );
  }

  const profile = await getUserProfile(user.id);

  if (!profile) {
    return (
      <div className="p-4 sm:p-8">
        <PageHeader title="Mi cuenta" />
        <p className="text-sm text-foreground">No se pudo cargar tu perfil.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 flex flex-col gap-6">
      <PageHeader title="Mi cuenta" description={ROLE_LABELS[user.role] ?? user.role} />
      <ProfileForm username={profile.username} name={profile.name} email={profile.email} />
      <PasswordForm />
    </div>
  );
}
