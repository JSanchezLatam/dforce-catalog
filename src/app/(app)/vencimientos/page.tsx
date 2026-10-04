import { CalendarCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { toWorkshopDateKey } from "@/shared/datetime";
import { statusBadgeClassName } from "@/shared/ui/StatusBadge";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { ContactadoButton } from "@/modules/vencimientos/ContactadoButton";
import { describeDue } from "@/modules/vencimientos/display";
import { getDueVencimientos, type DueVencimiento } from "@/modules/vencimientos/service";

function toItem(row: DueVencimiento, todayKey: string) {
  return {
    key: `${row.vehiculoId}:${row.kind}:${row.periodKey}`,
    action: { vehiculoId: row.vehiculoId, kind: row.kind, periodKey: row.periodKey },
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    plate: row.plate,
    vehicle: [row.make, row.model].filter(Boolean).join(" "),
    unit: row.numeroUnidad ? `· ${row.numeroUnidad}` : null,
    ...describeDue(row, todayKey),
  };
}

type Item = ReturnType<typeof toItem>;

/**
 * "Vencimientos próximos" — the same `getDueVencimientos(now)` call the sidebar
 * badge uses, so the count and the rows cannot disagree.
 *
 * `DueVencimiento` carries server-only fields (`whatsappOptOut`, `clienteId`,
 * the raw phone). The rows are mapped to the explicit `Item` below and the
 * client button gets only `{vehiculoId, kind, periodKey}` — never the row.
 */
export default async function VencimientosPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "vencimientos.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">No tenés permiso para ver esta página.</p></div>;
  }

  const now = new Date();
  const todayKey = toWorkshopDateKey(now);
  const { rows } = await getDueVencimientos(now);
  const items = rows.map((row) => toItem(row, todayKey));

  return (
    <div className="p-8">
      <h1 className={PAGE_HEADING}>Vencimientos próximos</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Placas que se renuevan este mes o el próximo y seguros que vencen en los próximos 30 días. Los vencidos quedan
        hasta marcarlos como contactados.
      </p>

      {items.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CalendarCheck className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">Nada por vencer</h2>
              <p className="text-sm text-muted-foreground">No hay placas ni seguros por vencer en los próximos 30 días.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card size="sm" className="hidden md:block" data-testid="vencimientos-table">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Vehículo</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell><Customer item={item} /></TableCell>
                      <TableCell><Vehicle item={item} /></TableCell>
                      <TableCell>{item.when}</TableCell>
                      <TableCell><Chip item={item} /></TableCell>
                      <TableCell><ContactadoButton {...item.action} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <ul className="flex flex-col gap-3 md:hidden" data-testid="vencimientos-cards">
            {items.map((item) => (
              <li key={item.key} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <Customer item={item} />
                  <Chip item={item} />
                </div>
                <Vehicle item={item} />
                <div className="text-sm">{item.when}</div>
                <ContactadoButton {...item.action} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Customer({ item }: { item: Pick<Item, "customerName" | "customerPhone"> }) {
  return (
    <div>
      <div className="font-medium">{item.customerName}</div>
      <div className="text-xs text-muted-foreground">{item.customerPhone}</div>
    </div>
  );
}

function Vehicle({ item }: { item: Pick<Item, "plate" | "vehicle" | "unit"> }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-mono font-medium">{item.plate}</span>
      {item.vehicle}
      {item.unit && <span className="text-xs text-muted-foreground">{item.unit}</span>}
    </div>
  );
}

/** The `StatusBadge` colours without its icon: a chip here is a word, not a job state. */
function Chip({ item }: { item: Pick<Item, "chipLabel" | "chipStatus"> }) {
  return <span className={statusBadgeClassName(item.chipStatus)}>{item.chipLabel}</span>;
}
