import { LoginForm } from "@/modules/auth/LoginForm";
import { CARD } from "@/shared/ui/styles";

/**
 * R9.1 — the only route `proxy.ts`'s blanket guard excludes (see its
 * `matcher`). No `requireSession`/`can()` call — a session is exactly what
 * this page exists to obtain.
 *
 * PR9 — v2 restyle: centered `CARD` (rounded-2xl), brand mark matching
 * `LogoSlot`'s 40px rounded-square treatment, Spanish title/subtitle per the
 * confirmed "Login v2" mockup. ponytail: brand mark markup duplicated from
 * `LogoSlot.tsx` rather than shared — different container context (standalone
 * vs. rail), not worth a shared component for two call sites.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-dash-bg">
      <div className={`w-full max-w-sm ${CARD}`}>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-dash-purple text-sm font-bold text-dash-fg"
            aria-hidden="true"
          >
            D
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dash-fg">Dforce Catálogo</h1>
            <p className="text-sm text-dash-muted">Inicia sesión para continuar</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
