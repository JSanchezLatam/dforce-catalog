import { CalendarCheck } from "lucide-react";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { toWorkshopDateKey } from "@/shared/datetime";
import { statusBadgeClassName } from "@/shared/ui/StatusBadge";
import { PageHeader } from "@/shared/ui/PageHeader";
import { toE164 } from "@/modules/reminders/providers/whatsapp";
import { ContactDialog } from "@/modules/vencimientos/ContactDialog";
import { describeDue } from "@/modules/vencimientos/display";
import { getDueVencimientos, type DueVencimiento } from "@/modules/vencimientos/service";
import { getWorkshopConfig } from "@/modules/workshop-config/service";

/**
 * The opt-out and the phone are resolved HERE, on the server: `toE164` imports
 * the Kapso SDK and `env`, and the client must get only the `wa.me` digits or a
 * reason. Opt-out is checked first — it is a consent, the phone shape is not.
 */
function whatsappFor(row: DueVencimiento): { waPhone: string | null; waBlockedReason: string | null } {
  if (row.whatsappOptOut) return { waPhone: null, waBlockedReason: "El cliente pidió no recibir WhatsApp" };
  const e164 = toE164(row.customerPhone);
  if (!e164.ok) return { waPhone: null, waBlockedReason: "El teléfono del cliente no es un celular" };
  return { waPhone: e164.value.replace("+", ""), waBlockedReason: null };
}

type Workshop = { name: string | null; phone: string | null; hours: string | null; address: string | null };

function toItem(row: DueVencimiento, todayKey: string, workshop: Workshop) {
  const vehicle = [row.make, row.model].filter(Boolean).join(" ");
  return {
    key: `${row.vehiculoId}:${row.kind}:${row.periodKey}`,
    // The explicit allowlist of design.md "Dialog props" — never the row.
    contact: {
      vehiculoId: row.vehiculoId,
      kind: row.kind,
      periodKey: row.periodKey,
      overdue: row.state === "overdue",
      customerName: row.customerName,
      placa: row.plate,
      vehicleLabel: vehicle || null,
      ...whatsappFor(row),
      workshop,
    },
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    plate: row.plate,
    vehicle,
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
 * the raw phone) and `workshop_config` more (logo key, handles). The rows are
 * mapped to the explicit `Item` below and the client dialog gets only
 * `item.contact` — never a row or the config.
 */
export default async function VencimientosPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "vencimientos.read")) {
    return <PermissionDenied title="Vencimientos próximos" />;
  }

  const now = new Date();
  const todayKey = toWorkshopDateKey(now);
  const { rows } = await getDueVencimientos(now);
  const config = await getWorkshopConfig();
  const workshop = {
    name: config?.name ?? null,
    phone: config?.phone ?? null,
    hours: config?.hours ?? null,
    address: config?.address ?? null,
  };
  const items = rows.map((row) => toItem(row, todayKey, workshop));

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Vencimientos próximos"
        description="Placas que se renuevan este mes o el próximo y seguros que vencen en los próximos 30 días. Los vencidos quedan hasta marcarlos como contactados."
      />

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
                      <TableCell><ContactDialog {...item.contact} /></TableCell>
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
                <ContactDialog {...item.contact} />
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
  return <span className={`${statusBadgeClassName(item.chipStatus)} shrink-0 whitespace-nowrap`}>{item.chipLabel}</span>;
}
