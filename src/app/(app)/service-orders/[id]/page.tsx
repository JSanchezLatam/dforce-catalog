import { Fragment, type ReactNode } from "react";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BellRing, TriangleAlert } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { orderScope } from "@/modules/service-orders/scope";
import { getClienteById } from "@/modules/customers/queries";
import { listRemindersForOrder } from "@/modules/reminders/queries";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import { canChangeOrderPhotos, isClosedStatus, orderEditMode, workLineMode } from "@/modules/service-orders/edit-policy";
import { FUEL_LABEL, formatKilometraje, intakeInputsFor } from "@/modules/service-orders/intake";
import { AssignTecnicoControl } from "@/modules/service-orders/AssignTecnicoControl";
import { listOrderAssignees, listOrderLines } from "@/modules/service-orders/order-team";
import { OrderWorkCard } from "@/modules/service-orders/OrderWorkCard";
import { OrderPhotos } from "@/modules/service-orders/OrderPhotos";
import { OrderStatusControls } from "@/modules/service-orders/OrderStatusControls";
import { vehicleDescriptiveRows } from "@/modules/service-orders/vehicle-rows";
import { ServiceOrderFormTrigger } from "@/modules/service-orders/ServiceOrderFormTrigger";
import { listOrderPhotos } from "@/modules/service-orders/photos";
import { getOrdenServicioById } from "@/modules/service-orders/queries";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import { findTecnicoByUserId, listTecnicos } from "@/modules/technicians/queries";
import { formatDateTime } from "@/shared/datetime";
import { StatusBadge } from "@/shared/ui/StatusBadge";

export const dynamic = "force-dynamic";

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
    <div className="grid grid-cols-1 gap-1 py-2 border-b border-border last:border-0 sm:grid-cols-3 sm:gap-2">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground sm:col-span-2">{String(value)}</dd>
    </div>
  );
}

function receptionRow(label: string, value: ReactNode, last = false) {
  return (
    <div className={cn("grid grid-cols-1 gap-1 py-2 border-b border-border sm:grid-cols-3 sm:gap-2", last && "border-0")}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground sm:col-span-2">{value}</dd>
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
  const scope = orderScope(user);
  if (!can(user, "service-orders.read")) {
    return <PermissionDenied title="Orden de servicio" />;
  }

  const detail = await getOrdenServicioById(id, scope);
  if (!detail) notFound();

  const { orden, items } = detail;
  const canAssign = can(user, "service-orders.assign");
  // Assignment is staff-only and never on a closed order (not correctable), so
  // the roster is read only where the control would render.
  const canAssignNow = canAssign && !isClosedStatus(orden.status);
  const [clienteDetail, reminders, photos, assignees, lines, viewerTecnico, roster] = await Promise.all([
    getClienteById(orden.clienteId, scope),
    listRemindersForOrder(orden.id),
    listOrderPhotos(orden.id, scope),
    listOrderAssignees(orden.id),
    listOrderLines(orden.id),
    findTecnicoByUserId(user.id),
    canAssignNow ? listTecnicos() : Promise.resolve([]),
  ]);
  // ACTIVE roster (the default) minus who is already on the order; plain pairs for the client.
  const assigned = new Set(assignees.map((a) => a.tecnicoId));
  const assignable = roster.filter((t) => !assigned.has(t.id)).map(({ id, nombre }) => ({ id, nombre }));
  // The same predicates the photo routes enforce (status gate + role), resolved
  // here so only booleans cross to the client card.
  const photosOpen = canChangeOrderPhotos(orden.status, canAssign);
  // closed-order-lock: on a closed order only an administrador's audited
  // correction (password in each add/delete) may change photos.
  const correctingPhotos = !photosOpen && can(user, "service-orders.correct");
  const photosChangeable = photosOpen || correctingPhotos;
  const canAddPhotos = photosChangeable && can(user, "service-orders.write");
  const canDeletePhotos = photosChangeable && can(user, "service-orders.deletePhoto");
  // C4 — `includeInactive: true` (getClienteById's own vehicles read) means a
  // deactivated vehicle is still found here, so its identity+link render
  // exactly as for an active one (spec §"Service Order Detail Displays
  // Vehicle, Category, and Notes").
  const vehiculo = clienteDetail?.vehicles.find((v) => v.id === orden.vehiculoId);
  // A row shows when the motor applies OR a value was recorded anyway (the
  // vehicle's motor can change after the order), so a stored reading never hides.
  const inputs = intakeInputsFor(vehiculo?.motor);
  const showFuel = inputs.fuel || orden.nivelCombustible != null;
  const showBattery = inputs.battery || orden.bateriaPct != null;

  // The list's 8-character form (audit #15): a uuid broke across lines on a
  // phone. The full id stays in each element's `title`.
  const shortId = orden.id.slice(0, 8);
  const editMode = orderEditMode(user.role, orden.status);

  return (
    <div className="p-4 sm:p-8">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/service-orders" />}>Órdenes de servicio</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage title={orden.id}>{shortId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
          <CardTitle className="flex items-center gap-3 sm:flex-1">
            <span title={orden.id}>Orden {shortId}</span>
            <StatusBadge status={orden.status} label={ORDER_STATUS_LABEL[orden.status]} />
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* D11 — the same predicate the PATCH route enforces, so the
                control and the write cannot drift. An administrador on a closed
                order gets "Corregir" (closed-order-lock); only strings and
                booleans cross to the client trigger, no function is serialized. */}
            {editMode !== "refused" && (
              /* AGENTS.md's 44x44 floor. `ServiceOrderForm` renders its edit
                 trigger as `size="sm"` (h-7 = 28px) and exposes no `className`
                 for this mount to pass, so the floor is applied to its button
                 child from the wrapper. Giving `ServiceOrderFormTrigger` a
                 className passthrough would be the direct fix and is a
                 follow-up: that component is outside this work unit. */
              <div className="[&>button]:min-h-11 [&>button]:min-w-11">
                <ServiceOrderFormTrigger
                  order={orden}
                  /* Edit mode never renders `CustomerPicker` (the order's
                     customer is fixed), so this value is unreachable. */
                  canCreateCustomer={false}
                  motor={vehiculo?.motor ?? null}
                  triggerLabel={editMode === "correction" ? "Corregir" : undefined}
                />
              </div>
            )}
            {/* D8 — the entry point to the printed work order. `buttonVariants`
                on a plain `Link`, NOT `<Button render={<Link/>}>`, for the
                reason `customers/[id]/page.tsx:235` records; this page gains no
                client component from it. `min-h-11 min-w-11` is AGENTS.md's
                44x44 floor over `size="default"`'s `h-8`. */}
            <Link
              href={`/service-orders/${orden.id}/print`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "min-h-11 min-w-11")}
            >
              Imprimir
            </Link>
            <OrderStatusControls orderId={orden.id} status={orden.status} canAssign={canAssign} />
          </div>
        </CardHeader>
        <CardContent>
          <dl>
            <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
              <dt className="text-sm font-medium text-muted-foreground">Cliente</dt>
              <dd className="col-span-2 text-sm text-foreground">
                {clienteDetail ? (
                  <Link href={`/customers/${clienteDetail.cliente.id}`} className="text-primary hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
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
                    className="text-primary hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                  >
                    {vehiculo.plate}
                  </Link>
                ) : (
                  orden.vehiculoId
                )}
              </dd>
            </div>
            {/* Placeholder, not omission: the spec wants an unset field to read
                as "nothing recorded". The unit number is the one row the
                helper omits when empty. */}
            {vehiculo && vehicleDescriptiveRows(vehiculo).map((r) => (
              <Fragment key={r.label}>{field(r.label, r.value ?? "—")}</Fragment>
            ))}
            {field("Categoría", CATEGORIA_LABEL[orden.categoria])}
            {field("Descripción", orden.description)}
            {/* Mirrors the form's field, so it carries the form's label. The
                narrow list-column headers keep the short "Cita" on purpose —
                a column is width-constrained, a field label is not — and
                `REMINDER_TYPE_LABEL.appointment` above is a different concept
                entirely (a reminder kind, not this order's start time). */}
            {field("Fecha y hora de inicio", orden.appointmentAt && formatDateTime(orden.appointmentAt))}
            {field("Completada", orden.completedAt && formatDateTime(orden.completedAt))}
            {field("Creada", formatDateTime(orden.createdAt))}
            {field("Hallazgos", orden.hallazgos || "—")}
            {field("Recomendaciones", orden.recomendaciones || "—")}
            {field("Observaciones", orden.observaciones || "—")}
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Técnicos asignados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {assignees.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta orden todavía no tiene técnicos asignados.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {assignees.map((a) => (
                <li key={a.tecnicoId} className="flex items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm">
                  {a.nombre}
                  {!a.active && <span className="text-xs text-muted-foreground">Inactivo</span>}
                </li>
              ))}
            </ul>
          )}
          {canAssignNow && <AssignTecnicoControl orderId={orden.id} available={assignable} />}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Líneas de trabajo</CardTitle>
        </CardHeader>
        <CardContent>
          {/* RSC boundary: strings, numbers and booleans only. `mode` and
              `canManageAll` are the same predicates the work-line routes
              enforce, resolved here so no function is serialized. */}
          <OrderWorkCard
            orderId={orden.id}
            status={orden.status}
            assignees={assignees}
            lines={lines}
            mode={workLineMode(user.role, orden.status)}
            viewerTecnicoId={viewerTecnico?.id ?? null}
            canManageAll={canAssign}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Recepción</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            {receptionRow(
              "Kilometraje",
              orden.kilometraje == null ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  Sin kilometraje
                </span>
              ) : (
                formatKilometraje(orden.kilometraje)
              ),
              !showFuel && !showBattery,
            )}
            {showFuel &&
              receptionRow(
                "Combustible",
                orden.nivelCombustible == null ? "—" : FUEL_LABEL[orden.nivelCombustible],
                !showBattery,
              )}
            {showBattery && receptionRow("Batería", orden.bateriaPct == null ? "—" : `${orden.bateriaPct}%`, true)}
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Fotos de recepción</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <OrderPhotos
            orderId={orden.id}
            photos={photos}
            canAdd={canAddPhotos}
            canDelete={canDeletePhotos}
            correcting={correctingPhotos}
          />
          {!photosChangeable && (
            <p className="text-sm text-muted-foreground">
              {orden.status === "ready_for_review"
                ? "Las fotos de una orden lista para revisión las agrega el administrador o el jefe de taller."
                : "Las fotos no se pueden agregar ni borrar cuando la orden está terminada o cancelada."}
            </p>
          )}
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
                    <TableCell>{formatDateTime(reminder.scheduledFor)}</TableCell>
                    <TableCell>{formatDateTime(reminder.sentAt)}</TableCell>
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
