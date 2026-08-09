import { ForcedPasswordChangeForm } from "@/modules/account/ForcedPasswordChangeForm";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Deliberately outside the `(app)` route group, following `/login`: a user who
 * lands here is blocked from every other surface, so rendering the app shell
 * would hand them a sidebar whose every link bounces straight back to this
 * screen.
 *
 * Reaching this page means `src/proxy.ts` already validated the session — the
 * route is registered `"session-only"`, never Action-gated, because it is the
 * only screen that can clear the flag keeping the user here.
 */
export default function ChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-6 pt-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden="true"
            >
              D
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Cambia tu contraseña</h1>
              <p className="text-sm text-muted-foreground">
                Tu contraseña es temporal. Elige una nueva para continuar.
              </p>
            </div>
          </div>
          <ForcedPasswordChangeForm />
        </CardContent>
      </Card>
    </main>
  );
}
