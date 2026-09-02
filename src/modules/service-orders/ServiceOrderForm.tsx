"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Search } from "lucide-react";

import type { OrdenServicio, Producto, Vehiculo } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClienteListItem } from "@/modules/customers/queries";
import { CATEGORIA_LABEL, type ServiceCategory } from "./categories";
import { CustomerPicker } from "./CustomerPicker";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";

const CATEGORIA_OPTIONS = Object.entries(CATEGORIA_LABEL) as [ServiceCategory, string][];
const DEFAULT_CATEGORIA: ServiceCategory = CATEGORIA_OPTIONS[0][0];

/** = `ClienteListItem` — the route body (`GET /api/customers`) maps straight through (design.md). */
export type ServiceOrderCustomerOption = ClienteListItem;
export type ServiceOrderProductOption = Pick<Producto, "id" | "name" | "price">;

type CartLine = { productoId: string; productName: string; unitPrice: number | null; quantity: number };

/** `datetime-local` needs `YYYY-MM-DDTHH:mm`, no timezone suffix. */
function toDatetimeLocal(value?: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

/**
 * R20 — create an `orden_servicio` with parts; also edits `description`/
 * `appointmentAt` on an existing order (customer + parts are immutable after
 * creation — `service-orders/service.ts`'s `updateOrder` only patches those
 * two fields, per design.md §7's route table). "use client", Dialog+Input+
 * Label+Button+Table, `FIELD_ERROR` — mirrors `CustomerForm.tsx`; the
 * customer field is `CustomerPicker` (async, debounced `GET
 * /api/customers`, `customer-search-and-picker` change), and parts keep
 * `CatalogBuilderForm.tsx`'s search+Table idiom (client-side filter over an
 * already-fetched `products` list — no dedicated parts search route yet,
 * see `page.tsx`'s `PICKER_LIST_LIMIT`). POSTs to `/api/service-orders`
 * (create) or PATCHes `/api/service-orders/[id]` (edit) — tasks 5.3/5.4.
 */
export function ServiceOrderForm({
  products,
  order,
  selectedCustomer,
  canCreateCustomer,
  triggerLabel,
  onSaved,
}: {
  products: ServiceOrderProductOption[];
  /** Provided => edit mode (PATCH, description/appointmentAt only); omitted => create mode (POST). */
  order?: OrdenServicio | null;
  /**
   * The order's already-resolved customer (create mode: none yet; edit mode:
   * loaded server-side by id, e.g. `service-orders/[id]/page.tsx`'s
   * `getClienteById`) — rendered as selected regardless of the picker's
   * current search term (design.md decision).
   */
  selectedCustomer?: ServiceOrderCustomerOption | null;
  canCreateCustomer: boolean;
  triggerLabel?: ReactNode;
  onSaved?: (orden: OrdenServicio) => void;
}) {
  const isEdit = Boolean(order);
  const [open, setOpen] = useState(false);
  const [clienteId, setClienteId] = useState(order?.clienteId ?? selectedCustomer?.id ?? "");
  const [vehiculoId, setVehiculoId] = useState("");
  const [vehicles, setVehicles] = useState<Vehiculo[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [categoria, setCategoria] = useState<ServiceCategory>(order?.categoria ?? DEFAULT_CATEGORIA);
  const [hallazgos, setHallazgos] = useState(order?.hallazgos ?? "");
  const [recomendaciones, setRecomendaciones] = useState(order?.recomendaciones ?? "");
  const [observaciones, setObservaciones] = useState(order?.observaciones ?? "");
  const [description, setDescription] = useState(order?.description ?? "");
  const [appointmentAt, setAppointmentAt] = useState(toDatetimeLocal(order?.appointmentAt));
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * D2 — fetches the chosen customer's ACTIVE vehicles on every `clienteId`
   * change (never seeded alongside the customer: `ClienteListItem.plates` is
   * plate strings with no vehicle ids). Create mode only — the vehicle is
   * immutable post-creation, like customer and parts, so an edit-mode order
   * never needs this list. Only the fetch lives here — clearing the previous
   * selection/list is not something to observe after the fact, it is what
   * changing the customer MEANS, so it happens in `handleCustomerSelect`/
   * `resetForm` below (same convention `CatalogBuilderForm.tsx`'s category
   * effect already established). `cancelled` guards a slow response for a
   * customer that is no longer selected from repainting over a faster later
   * one — the SAME-HANDLER clear is what actually prevents the stale-
   * selection defect; this guard only prevents a stale vehicle LIST from
   * flashing in.
   */
  useEffect(() => {
    if (isEdit || !clienteId) return;
    let cancelled = false;
    fetch(`/api/customers/${clienteId}/vehicles`)
      .then((response) => (response.ok ? response.json() : { vehicles: [] }))
      .then((body: { vehicles: Vehiculo[] }) => {
        if (!cancelled) setVehicles(body.vehicles);
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clienteId, isEdit]);

  function handleCustomerSelect(customer: ServiceOrderCustomerOption) {
    setClienteId(customer.id);
    setVehiculoId("");
    setVehicles([]);
    setVehiclesLoading(true);
  }

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const q = searchQuery.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [products, searchQuery]);

  function resetForm() {
    const nextClienteId = order?.clienteId ?? selectedCustomer?.id ?? "";
    setClienteId(nextClienteId);
    setVehiculoId("");
    setVehicles([]);
    // Mirrors `handleCustomerSelect`: a non-empty clienteId (edit mode, or a
    // pre-picked `selectedCustomer`) means the fetch effect is about to run.
    setVehiclesLoading(!isEdit && Boolean(nextClienteId));
    setCategoria(order?.categoria ?? DEFAULT_CATEGORIA);
    setHallazgos(order?.hallazgos ?? "");
    setRecomendaciones(order?.recomendaciones ?? "");
    setObservaciones(order?.observaciones ?? "");
    setDescription(order?.description ?? "");
    setAppointmentAt(toDatetimeLocal(order?.appointmentAt));
    setSearchQuery("");
    setCart([]);
    setErrors({});
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) resetForm();
  }

  function addPart(product: ServiceOrderProductOption) {
    setCart((prev) => {
      const existing = prev.find((line) => line.productoId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.productoId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...prev, { productoId: product.id, productName: product.name, unitPrice: product.price, quantity: 1 }];
    });
  }

  function updateQuantity(productoId: string, quantity: number) {
    setCart((prev) => prev.map((line) => (line.productoId === productoId ? { ...line, quantity } : line)));
  }

  function removePart(productoId: string) {
    setCart((prev) => prev.filter((line) => line.productoId !== productoId));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});

    try {
      const response = isEdit
        ? await fetch(`/api/service-orders/${order!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: description.trim() || null,
              appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
              categoria,
              hallazgos: hallazgos.trim() || null,
              recomendaciones: recomendaciones.trim() || null,
              observaciones: observaciones.trim() || null,
            }),
          })
        : await fetch("/api/service-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clienteId,
              vehiculoId,
              categoria,
              description: description.trim() || undefined,
              appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : undefined,
              items: cart.map((line) => ({
                productoId: line.productoId,
                productName: line.productName,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
              })),
            }),
          });

      if (response.status === 400) {
        const body = await response.json();
        setErrors(
          body.errors ?? { clienteId: body.error === "unknown_cliente" ? "Seleccioná un cliente válido" : body.error },
        );
        return;
      }

      if (!response.ok) {
        setErrors({ form: "No se pudo guardar la orden de servicio. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      setOpen(false);
      onSaved?.(body.orden);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={isEdit ? "outline" : "default"} size={isEdit ? "sm" : "default"} />}>
        {triggerLabel ?? (isEdit ? "Editar orden" : "Nueva orden de servicio")}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar orden de servicio" : "Nueva orden de servicio"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            {!isEdit && (
              <div className="grid gap-2">
                <Label>Cliente</Label>
                <CustomerPicker
                  selectedCustomer={selectedCustomer ?? null}
                  canCreateCustomer={canCreateCustomer}
                  onSelect={handleCustomerSelect}
                />
                {errors.clienteId && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.clienteId}
                  </p>
                )}
              </div>
            )}

            {!isEdit && (
              <div className="grid gap-2">
                <Label htmlFor="orden-vehiculo">Vehículo</Label>
                {/* Native <select>, not the base-ui Select this repo otherwise
                    uses for dropdowns (ServiceOrderFilters.tsx) — no test in
                    this repo exercises that component yet and this form has
                    no other reason to add the jsdom shims it needs. */}
                <select
                  id="orden-vehiculo"
                  className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  value={vehiculoId}
                  disabled={!clienteId || vehiclesLoading || vehicles.length === 0}
                  onChange={(e) => setVehiculoId(e.target.value)}
                >
                  <option value="">Seleccioná un vehículo</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate}
                      {v.make ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
                    </option>
                  ))}
                </select>
                {clienteId && !vehiclesLoading && vehicles.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Este cliente no tiene vehículos activos. Agregá uno primero.
                  </p>
                )}
                {errors.vehiculoId && (
                  <p role="alert" className={FIELD_ERROR}>
                    {errors.vehiculoId}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="orden-categoria">Categoría</Label>
              {/* Native <select>, same rationale as the vehicle picker above. */}
              <select
                id="orden-categoria"
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as ServiceCategory)}
              >
                {CATEGORIA_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="orden-description">Descripción</Label>
              <Input id="orden-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="orden-appointment">Cita</Label>
              <Input
                id="orden-appointment"
                type="datetime-local"
                value={appointmentAt}
                onChange={(e) => setAppointmentAt(e.target.value)}
              />
            </div>

            {/*
             * C4 — technician findings, only meaningful once the vehicle has
             * actually been examined, so these are edit-only (spec §"Category
             * and Completion Notes Editing"): never shown/settable at
             * creation, only through this patch path.
             */}
            {isEdit && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="orden-hallazgos">Hallazgos</Label>
                  <textarea
                    id="orden-hallazgos"
                    className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none"
                    value={hallazgos}
                    onChange={(e) => setHallazgos(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="orden-recomendaciones">Recomendaciones</Label>
                  <textarea
                    id="orden-recomendaciones"
                    className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none"
                    value={recomendaciones}
                    onChange={(e) => setRecomendaciones(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="orden-observaciones">Observaciones</Label>
                  <textarea
                    id="orden-observaciones"
                    className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                  />
                </div>
              </>
            )}

            {!isEdit && (
              <section aria-label="Parts selection">
                <h2 className={SECTION_HEADING}>Piezas</h2>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    placeholder="Buscar producto…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                            Sin resultados
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredProducts.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell className="text-muted-foreground">{product.id}</TableCell>
                          <TableCell>
                            <Button type="button" variant="outline" size="sm" onClick={() => addPart(product)}>
                              Agregar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {cart.length > 0 && (
                  <div className="mt-3 rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pieza</TableHead>
                          <TableHead className="w-24">Cantidad</TableHead>
                          <TableHead className="w-16" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cart.map((line) => (
                          <TableRow key={line.productoId}>
                            <TableCell className="font-medium">{line.productName}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={1}
                                value={line.quantity}
                                onChange={(e) => updateQuantity(line.productoId, Math.max(1, Number(e.target.value)))}
                                className="w-16"
                              />
                            </TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="sm" onClick={() => removePart(line.productoId)}>
                                Quitar
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            )}

            {errors.form && (
              <p role="alert" className={FIELD_ERROR}>
                {errors.form}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || (!isEdit && !vehiculoId)}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
