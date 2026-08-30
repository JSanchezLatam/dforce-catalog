import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";

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
import { CustomerFormTrigger } from "@/modules/customers/CustomerFormTrigger";
import { getClienteById } from "@/modules/customers/queries";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { CARD, CHIP, PLATE_BADGE } from "@/shared/ui/styles";

export const dynamic = "force-dynamic";

const ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};

function field(label: string, value: unknown) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm text-foreground">{String(value)}</dd>
    </div>
  );
}

/**
 * R16 — customer detail: info Card (incl. the two R26 opt-out flags' current
 * state, read-only + an "Editar" trigger into `CustomerForm`) + service
 * history Table (this customer's `orden_servicio` rows, most-recent first —
 * `getClienteById`'s queryFn contract), empty-state when zero orders.
 * Mirrors `inventory/[id]/page.tsx`'s Breadcrumb + Card + `field()` pattern
 * (design.md §8).
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "customers.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const detail = await getClienteById(id);

  if (!detail) notFound();

  const { cliente, orders, vehicles } = detail;

  return (
    <div className="p-8">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/customers" />}>Clientes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{cliente.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{cliente.name}</CardTitle>
          <CustomerFormTrigger cliente={cliente} vehicles={vehicles} triggerLabel="Editar" />
        </CardHeader>
        <CardContent>
          <dl>
            {field("Teléfono", cliente.phone)}
            {field("Email", cliente.email)}
            {field("Recordatorios WhatsApp", cliente.whatsappOptOut ? "Desactivados" : "Activos")}
            {field("Recordatorios email", cliente.emailOptOut ? "Desactivados" : "Activos")}
          </dl>
        </CardContent>
      </Card>

      {/*
       * Master-detail (design direction): customer header above, vehicle
       * collection below. A deactivated vehicle stays visible but visibly
       * secondary (`opacity-70` + the "Vehículo desactivado" label) — no
       * show/hide toggle here: `UsersTable`'s `showInactive` idiom fits a
       * many-row admin table, but one customer's own handful of vehicles is
       * small enough to just always show. Restoring one happens from
       * "Editar" (`CustomerForm` carries the actual restore action); this
       * view is read-only.
       */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Vehículos</CardTitle>
        </CardHeader>
        <CardContent>
          {vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene vehículos registrados.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {vehicles.map((vehiculo) => (
                <div
                  key={vehiculo.id}
                  className={CARD + " flex flex-col gap-2" + (vehiculo.deactivatedAt ? " opacity-70" : "")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={PLATE_BADGE}>{vehiculo.plate}</span>
                    {vehiculo.deactivatedAt && (
                      <span className="text-xs font-medium text-muted-foreground">Vehículo desactivado</span>
                    )}
                  </div>
                  {(vehiculo.make || vehiculo.model || vehiculo.year) && (
                    <div className="flex flex-wrap gap-1.5">
                      {vehiculo.make && <span className={CHIP}>{vehiculo.make}</span>}
                      {vehiculo.model && <span className={CHIP}>{vehiculo.model}</span>}
                      {vehiculo.year && <span className={CHIP}>{vehiculo.year}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
              <p className="text-sm text-muted-foreground">Este cliente todavía no tiene órdenes registradas.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
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
                    <TableCell>{orden.description ?? "—"}</TableCell>
                    <TableCell>{orden.appointmentAt ? orden.appointmentAt.toLocaleString() : "—"}</TableCell>
                    <TableCell>{orden.createdAt.toLocaleString()}</TableCell>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
