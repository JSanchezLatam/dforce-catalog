import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getUserProfile } from "@/modules/account/queries";
import { ProfileForm } from "@/modules/account/ProfileForm";
import { PasswordForm } from "@/modules/account/PasswordForm";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { ROLE_LABELS } from "@/modules/auth/roles";

export default async function AccountPage() {
  const user = await requireSessionFromHeaders();

  if (!can(user, "account.self")) {
    return (
      <div className="p-8">
        <h1 className={PAGE_HEADING}>Mi cuenta</h1>
        <p className="text-sm text-foreground">No tienes permiso para ver esta página.</p>
      </div>
    );
  }

  const profile = await getUserProfile(user.id);

  if (!profile) {
    return (
      <div className="p-8">
        <h1 className={PAGE_HEADING}>Mi cuenta</h1>
        <p className="text-sm text-foreground">No se pudo cargar tu perfil.</p>
      </div>
    );
  }

  return (
    <div className="p-8 flex flex-col gap-6">
      <div>
        <h1 className={PAGE_HEADING}>Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">{ROLE_LABELS[user.role] ?? user.role}</p>
      </div>
      <ProfileForm username={profile.username} name={profile.name} email={profile.email} />
      <PasswordForm />
    </div>
  );
}
