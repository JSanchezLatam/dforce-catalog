import { can } from "@/modules/auth/policy";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getUserProfile } from "@/modules/account/queries";
import { ProfileForm } from "@/modules/account/ProfileForm";
import { PasswordForm } from "@/modules/account/PasswordForm";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ROLE_LABELS } from "@/modules/auth/roles";
import { listOwnFeedback } from "@/modules/feedback/service";
import { MyFeedbackCard } from "@/modules/feedback/MyFeedbackCard";
import { formatDateTime, toWorkshopDateKey } from "@/shared/datetime";
import { requiresTwoFactor, twoFactorStatus } from "@/modules/auth/enrolment";
import { TwoFactorSection } from "@/modules/account/TwoFactorSection";

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

  // Strings only across the boundary into the client card: dates are formatted here, in the workshop's zone.
  const feedbackRows = can(user, "feedback.send")
    ? (await listOwnFeedback(user.id)).map((r) => ({
        id: r.id,
        category: r.category,
        text: r.text,
        screenLabel: r.screenLabel,
        createdAt: formatDateTime(r.createdAt),
        delivered: r.deliveredAt !== null,
      }))
    : null;

  const twoFactor = await twoFactorStatus(user.id);

  return (
    <div className="p-4 sm:p-8 flex flex-col gap-6">
      <PageHeader title="Mi cuenta" description={ROLE_LABELS[user.role] ?? user.role} />
      <ProfileForm username={profile.username} name={profile.name} email={profile.email} />
      {/* dd/mm/aaaa (mockup s4), built from the workshop-zone date key: es-PA's own short date is month-first. */}
      <TwoFactorSection
        enabled={twoFactor.enabled}
        enabledOn={twoFactor.enabledAt ? toWorkshopDateKey(twoFactor.enabledAt).split("-").reverse().join("/") : null}
        codesLeft={twoFactor.codesLeft}
        mandatory={requiresTwoFactor(user.role)}
      />
      <PasswordForm />
      {feedbackRows && <MyFeedbackCard rows={feedbackRows} />}
    </div>
  );
}
