import { Card, CardContent } from "@/components/ui/card";
import { ROLE_LABELS } from "@/modules/auth/roles";
import type { SessionUser } from "@/modules/auth/session";

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
export function InventoryStatsHeader({
  user,
  total,
  syncButton,
}: {
  user: SessionUser;
  total: number;
  syncButton?: React.ReactNode;
}) {
  const roleLabel = ROLE_LABELS[user.role];

  return (
    <div className="mb-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xl font-bold text-foreground">Hola, {roleLabel}</p>
          <p className="text-sm text-muted-foreground">Bienvenido de nuevo a tu panel</p>
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
          aria-hidden="true"
        >
          {roleLabel.charAt(0)}
        </div>
      </div>
      <Card size="sm">
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total de productos</p>
              <p className="text-3xl font-bold text-foreground">{total}</p>
              <p className="text-sm text-muted-foreground">sincronizados desde Interfuerza</p>
            </div>
            {syncButton}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
