import type { SessionUser } from "@/modules/auth/session";
import { CARD } from "@/shared/ui/styles";

const ROLE_LABELS: Record<SessionUser["role"], string> = {
  administrador: "Administrador",
  usuario: "Usuario",
};

/**
 * PR10 — greeting/avatar topbar row + a single stat card summarizing the
 * inventory total, per the confirmed "Dashboard v2 - Inventario" mockup.
 * Purely presentational — no data fetching here, `total` and `user` are
 * already available at the page's Server Component call site.
 *
 * ponytail: `SessionUser` only carries `id`/`role` (proxy.ts forwards just
 * those two headers, see auth/session.ts) — no `username` exists without an
 * extra DB round-trip for a cosmetic greeting, so this greets by role
 * ("Hola, Administrador"/"Hola, Usuario") instead of a real display name.
 */
export function InventoryStatsHeader({ user, total }: { user: SessionUser; total: number }) {
  const roleLabel = ROLE_LABELS[user.role];

  return (
    <div className="mb-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xl font-bold text-dash-fg">Hola, {roleLabel}</p>
          <p className="text-sm text-dash-muted">Bienvenido de nuevo a tu panel</p>
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full bg-dash-purple text-sm font-bold text-white"
          aria-hidden="true"
        >
          {roleLabel.charAt(0)}
        </div>
      </div>
      <div className={CARD}>
        <p className="text-xs font-semibold uppercase tracking-wide text-dash-muted">Total de productos</p>
        <p className="mt-1 text-3xl font-bold text-dash-fg">{total}</p>
        <p className="mt-1 text-sm text-dash-muted">sincronizados desde Interfuerza</p>
      </div>
    </div>
  );
}
