"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Search } from "lucide-react";

import type { Cliente, OrdenServicio, Producto } from "@/shared/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FIELD_ERROR, SECTION_HEADING } from "@/shared/ui/styles";

export type ServiceOrderCustomerOption = Pick<Cliente, "id" | "name" | "phone">;
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
 * Label+Button+Select+Table, `FIELD_ERROR` — mirrors `CustomerForm.tsx` and
 * reuses `CatalogBuilderForm.tsx`'s search+Table idiom for the parts picker
 * (client-side filter over an already-fetched `products` list, no new
 * search route). POSTs to `/api/service-orders` (create) or PATCHes
 * `/api/service-orders/[id]` (edit) — tasks 5.3/5.4.
 */
export function ServiceOrderForm({
  customers,
  products,
  order,
  triggerLabel,
  onSaved,
}: {
  customers: ServiceOrderCustomerOption[];
  products: ServiceOrderProductOption[];
  /** Provided => edit mode (PATCH, description/appointmentAt only); omitted => create mode (POST). */
  order?: OrdenServicio | null;
  triggerLabel?: ReactNode;
  onSaved?: (orden: OrdenServicio) => void;
}) {
  const isEdit = Boolean(order);
  const [open, setOpen] = useState(false);
  const [clienteId, setClienteId] = useState(order?.clienteId ?? "");
  const [description, setDescription] = useState(order?.description ?? "");
  const [appointmentAt, setAppointmentAt] = useState(toDatetimeLocal(order?.appointmentAt));
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const q = searchQuery.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [products, searchQuery]);

  function resetForm() {
    setClienteId(order?.clienteId ?? "");
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
            }),
          })
        : await fetch("/api/service-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clienteId,
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!isEdit && (
            <div className="grid gap-2">
              <Label htmlFor="orden-cliente">Cliente</Label>
              <Select value={clienteId} onValueChange={(value) => setClienteId(value ?? "")}>
                <SelectTrigger id="orden-cliente">
                  <SelectValue placeholder="Seleccioná un cliente" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.clienteId && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.clienteId}
                </p>
              )}
            </div>
          )}

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

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || (!isEdit && !clienteId)}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
