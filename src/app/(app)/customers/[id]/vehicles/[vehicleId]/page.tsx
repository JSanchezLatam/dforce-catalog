import Link from "next/link";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { notFound } from "next/navigation";
import { CalendarDays, ClipboardList } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { getClienteById } from "@/modules/customers/queries";
import { MONTH_NAMES, MOTOR_LABEL } from "@/modules/customers/vehicle-options";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import { listOrdenesByVehiculo } from "@/modules/service-orders/queries";
import { formatDateTime } from "@/shared/datetime";
import { RecordCard, RecordCardList } from "@/shared/ui/RecordCard";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { CHIP, PLATE_BADGE, PLATE_BADGE_MUTED } from "@/shared/ui/styles";

export const dynamic = "force-dynamic";

function field(label: string, value: string | null | undefined) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

/**
 * C4/design.md D6 — nested under `customers/[id]` because `vehiculo` has no
 * independent lifecycle or list route. `getClienteById(id)` reads with
 * `includeInactive: true`, so a deactivated vehicle's screen still renders
 * (spec scenario). Finding the vehicle inside THIS customer's own collection
 * is what makes a mismatched `/customers/A/vehicles/<B's vehicle>` a 404 —
 * the ownership check is free, not extra code.
 */
export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string; vehicleId: string }>;
}) {
  const { id, vehicleId } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "customers.read")) {
    return <PermissionDenied title="Vehículo" />;
  }

  const detail = await getClienteById(id);
  if (!detail) notFound();

  const vehiculo = detail.vehicles.find((v) => v.id === vehicleId);
  if (!vehiculo) notFound();

  const orders = await listOrdenesByVehiculo(vehiculo.id);
  const canSeeInternal = can(user, "vencimientos.read");

  return (
    <div className="p-4 sm:p-8">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/customers" />}>Clientes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={`/customers/${detail.cliente.id}`} />}>
              {detail.cliente.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{vehiculo.plate}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="mb-6">
        <CardHeader>
          {/* The customer list tells active from deactivated by WEIGHT, not by a
              caption (design.md D6) — the first question a workshop asks is
              which of these it can work on. Task 3.3 made the muted card a
              link, so this screen has to keep that distinction instead of
              rendering a retired car exactly like a working one. */}
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className={vehiculo.deactivatedAt ? PLATE_BADGE_MUTED : PLATE_BADGE}>{vehiculo.plate}</span>
            {vehiculo.make && <span className={CHIP}>{vehiculo.make}</span>}
            {vehiculo.model && <span className={CHIP}>{vehiculo.model}</span>}
            {vehiculo.year && <span className={CHIP}>{vehiculo.year}</span>}
            {vehiculo.deactivatedAt && (
              <span className="text-sm font-normal text-muted-foreground">Vehículo desactivado</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            {field("Chasis", vehiculo.chasis)}
            {field("Color primario", vehiculo.colorPrimario)}
            {field("Color secundario", vehiculo.colorSecundario)}
            {field("Estilo", vehiculo.estilo)}
            {field("Motor", vehiculo.motor && MOTOR_LABEL[vehiculo.motor])}
            {field("Nº de unidad", vehiculo.numeroUnidad)}
            {/* Internal: only with `vencimientos.read`. Named fields, so a
                column added to `vehiculo` later stays hidden by default. */}
            {canSeeInternal &&
              field(
                "Mes de renovación de placa",
                vehiculo.placaRenovacionMes ? capitalize(MONTH_NAMES[vehiculo.placaRenovacionMes - 1]) : null,
              )}
            {/* Split from the stored `YYYY-MM-DD`, never parsed: a date-only
                string read as a `Date` is off by a day in a western zone. */}
            {canSeeInternal && field("Vencimiento del seguro", vehiculo.seguroVence?.split("-").reverse().join("/"))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de órdenes de servicio</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">Sin órdenes de servicio</h2>
              <p className="text-sm text-muted-foreground">Este vehículo todavía no tiene órdenes registradas.</p>
            </div>
          ) : (
            <>
            <div className="hidden md:block" data-testid="history-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Cita</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead className="w-24">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((orden) => (
                  <TableRow key={orden.id}>
                    <TableCell>
                      <StatusBadge status={orden.status} label={ORDER_STATUS_LABEL[orden.status]} />
                    </TableCell>
                    <TableCell>{CATEGORIA_LABEL[orden.categoria]}</TableCell>
                    <TableCell>{orden.description ?? "—"}</TableCell>
                    <TableCell>{formatDateTime(orden.appointmentAt)}</TableCell>
                    <TableCell>{formatDateTime(orden.createdAt)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/service-orders/${orden.id}`}
                        className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
                      >
                        Ver
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          <RecordCardList testId="history-cards">
            {orders.map((orden) => (
              <RecordCard key={orden.id} href={`/service-orders/${orden.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm"><div className="font-medium">{CATEGORIA_LABEL[orden.categoria]}</div>
                    <div className="text-muted-foreground">{orden.description ?? "—"}</div></div>
                  <StatusBadge
                    status={orden.status}
                    label={ORDER_STATUS_LABEL[orden.status]}
                    className="shrink-0 whitespace-nowrap"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  <span>Cita</span> {formatDateTime(orden.appointmentAt)}
                </div>
              </RecordCard>
            ))}
          </RecordCardList>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
