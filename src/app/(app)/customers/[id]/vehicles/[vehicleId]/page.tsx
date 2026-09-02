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
import { getClienteById } from "@/modules/customers/queries";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { listOrdenesByVehiculo } from "@/modules/service-orders/queries";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { CHIP, PLATE_BADGE } from "@/shared/ui/styles";

export const dynamic = "force-dynamic";

const ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};

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
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const detail = await getClienteById(id);
  if (!detail) notFound();

  const vehiculo = detail.vehicles.find((v) => v.id === vehicleId);
  if (!vehiculo) notFound();

  const orders = await listOrdenesByVehiculo(vehiculo.id);

  return (
    <div className="p-8">
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
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className={PLATE_BADGE}>{vehiculo.plate}</span>
            {vehiculo.make && <span className={CHIP}>{vehiculo.make}</span>}
            {vehiculo.model && <span className={CHIP}>{vehiculo.model}</span>}
            {vehiculo.year && <span className={CHIP}>{vehiculo.year}</span>}
          </CardTitle>
        </CardHeader>
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
