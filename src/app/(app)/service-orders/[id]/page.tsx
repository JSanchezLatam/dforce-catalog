import Link from "next/link";
import { notFound } from "next/navigation";
import { BellRing } from "lucide-react";

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
import { listRemindersForOrder } from "@/modules/reminders/queries";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { OrderStatusControls } from "@/modules/service-orders/OrderStatusControls";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
import { StatusBadge } from "@/shared/ui/StatusBadge";

export const dynamic = "force-dynamic";

const ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};

const REMINDER_TYPE_LABEL: Record<string, string> = {
  appointment: "Cita",
  service_due: "Servicio pendiente",
};

const REMINDER_CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
};

const REMINDER_STATUS_LABEL: Record<string, string> = {
  scheduled: "Programado",
  sent: "Enviado",
  failed: "Falló",
  cancelled: "Cancelado",
  skipped: "Omitido",
  opted_out: "Cliente dio de baja",
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
 * R20/R21/R24/R25/R26 — order header + status-transition controls (calling
 * Phase 5's PATCH route), line-items table, and this order's scheduled/sent
 * reminders (incl. each row's `opted_out` status, R26, distinct from the
 * generic `skipped`). Mirrors `inventory/[id]/page.tsx`'s Breadcrumb + Card +
 * `field()` pattern (design.md §8).
 */
export default async function ServiceOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "service-orders.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const detail = await getOrdenServicioById(id);
  if (!detail) notFound();

  const { orden, items } = detail;
  const [clienteDetail, reminders] = await Promise.all([
    getClienteById(orden.clienteId),
    listRemindersForOrder(orden.id),
  ]);
  // C4 — `includeInactive: true` (getClienteById's own vehicles read) means a
  // deactivated vehicle is still found here, so its identity+link render
  // exactly as for an active one (spec §"Service Order Detail Displays
  // Vehicle, Category, and Notes").
  const vehiculo = clienteDetail?.vehicles.find((v) => v.id === orden.vehiculoId);

  return (
    <div className="p-8">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/service-orders" />}>Órdenes de servicio</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{orden.id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            Orden {orden.id}
            <StatusBadge status={orden.status} label={ORDER_STATUS_LABEL[orden.status]} />
          </CardTitle>
          <OrderStatusControls orderId={orden.id} status={orden.status} />
        </CardHeader>
        <CardContent>
          <dl>
            <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
              <dt className="text-sm font-medium text-muted-foreground">Cliente</dt>
              <dd className="col-span-2 text-sm text-foreground">
                {clienteDetail ? (
                  <Link href={`/customers/${clienteDetail.cliente.id}`} className="text-primary hover:underline">
                    {clienteDetail.cliente.name}
                  </Link>
                ) : (
                  orden.clienteId
                )}
              </dd>
            </div>
            <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
              <dt className="text-sm font-medium text-muted-foreground">Vehículo</dt>
              <dd className="col-span-2 text-sm text-foreground">
                {vehiculo ? (
                  <Link
                    href={`/customers/${orden.clienteId}/vehicles/${vehiculo.id}`}
                    className="text-primary hover:underline"
                  >
                    {vehiculo.plate}
                  </Link>
                ) : (
                  orden.vehiculoId
                )}
              </dd>
            </div>
            {field("Categoría", CATEGORIA_LABEL[orden.categoria])}
            {field("Descripción", orden.description)}
            {field("Cita", orden.appointmentAt?.toLocaleString())}
            {field("Completada", orden.completedAt?.toLocaleString())}
            {field("Creada", orden.createdAt.toLocaleString())}
            {field("Hallazgos", orden.hallazgos ?? "—")}
            {field("Recomendaciones", orden.recomendaciones ?? "—")}
            {field("Observaciones", orden.observaciones ?? "—")}
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Piezas utilizadas</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta orden no tiene piezas registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pieza</TableHead>
                  <TableHead>Precio unitario</TableHead>
                  <TableHead>Cantidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell>{item.unitPrice != null ? `$${item.unitPrice.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recordatorios</CardTitle>
        </CardHeader>
        <CardContent>
          {reminders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <BellRing className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Esta orden no tiene recordatorios programados.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Programado para</TableHead>
                  <TableHead>Enviado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reminders.map((reminder) => (
                  <TableRow key={reminder.id}>
                    <TableCell>{REMINDER_TYPE_LABEL[reminder.type]}</TableCell>
                    <TableCell>{REMINDER_CHANNEL_LABEL[reminder.channel]}</TableCell>
                    <TableCell>
                      <StatusBadge status={reminder.status} label={REMINDER_STATUS_LABEL[reminder.status]} />
                    </TableCell>
                    <TableCell>{reminder.scheduledFor.toLocaleString()}</TableCell>
                    <TableCell>{reminder.sentAt ? reminder.sentAt.toLocaleString() : "—"}</TableCell>
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
