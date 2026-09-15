"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { OrdenServicio, Vehiculo } from "@/shared/db/schema";
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
import type { ClienteListItem } from "@/modules/customers/queries";
import { VehicleQuickForm } from "@/modules/customers/VehicleQuickForm";
import { CATEGORIA_LABEL, type ServiceCategory } from "./categories";
import { CustomerPicker } from "./CustomerPicker";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { CONNECTION_ERROR } from "@/shared/ui/messages";

const CATEGORIA_OPTIONS = Object.entries(CATEGORIA_LABEL) as [ServiceCategory, string][];

/**
 * Shared by every native <select>/<textarea> in this form. `outline-none` is
 * the load-bearing half of a pair: it defeats the global `*:focus-visible`
 * ring in globals.css — Tailwind's utilities layer wins over base, and
 * `.outline-none` also clears the very variable that base rule resolves its
 * outline style from — so a control that sets it MUST bring its own ring back.
 * `components/ui/input.tsx` does exactly this; these controls copied the first
 * half without the second and were invisible to a keyboard user.
 */
const NATIVE_FIELD =
  "w-full min-w-0 rounded-lg border border-input bg-transparent text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** = `ClienteListItem` — the route body (`GET /api/customers`) maps straight through (design.md). */
export type ServiceOrderCustomerOption = ClienteListItem;

/**
 * `datetime-local` needs `YYYY-MM-DDTHH:mm` with no timezone suffix — and the
 * browser reads that as LOCAL time. Built from local getters for exactly that
 * reason. It used to be `toISOString().slice(0, 16)`, a UTC wall clock, while
 * `handleSubmit` parsed the same string back with `new Date()`, which per
 * ECMAScript treats an offset-less date-TIME string as local (date-ONLY strings
 * are UTC — that asymmetry is the trap). The two halves disagreed by the UTC
 * offset, so every save shifted the appointment and the shifts compounded:
 * in Panama, 14:00Z → 19:00Z → 00:00Z the next day (task 2.10).
 */
function toDatetimeLocal(value?: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * R20 — creates an `orden_servicio`; also patches `categoria`, `description`,
 * `appointmentAt`, `hallazgos`, `recomendaciones` and `observaciones` on an
 * existing one (`cliente` and `vehiculo` are immutable after creation —
 * `updateOrder` does not accept either). "use client", Dialog+Input+Label+
 * Button, `FIELD_ERROR` — mirrors `CustomerForm.tsx`; the customer field is
 * `CustomerPicker` (async, debounced `GET /api/customers`,
 * `customer-search-and-picker` change). POSTs to `/api/service-orders`
 * (create) or PATCHes `/api/service-orders/[id]` (edit).
 *
 * D7 — creation collects NO parts: the order is printed and handed to a
 * técnico, and parts are chosen while the work happens, not while it is
 * booked. `ordenServicioItem` keeps its table and its detail card, and loses
 * its only writer.
 */
/** Error keys this form has a place to show. Anything else routes to `form`. */
const RENDERED_ERROR_FIELDS = new Set(["clienteId", "vehiculoId", "form"]);

const VEHICLES_EMPTY_HINT_ID = "orden-vehiculo-empty-hint";

export function ServiceOrderForm({
  order,
  selectedCustomer,
  canCreateCustomer,
  triggerLabel,
  onSaved,
}: {
  /** Provided => edit mode (PATCH); omitted => create mode (POST). */
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
  const [vehiclesRetry, setVehiclesRetry] = useState(0);
  const [fetchedVehicles, setFetchedVehicles] = useState<{ key: string; vehicles: Vehiculo[]; failed: boolean }>({
    key: "",
    vehicles: [],
    failed: false,
  });
  const [categoria, setCategoria] = useState<ServiceCategory | "">(order?.categoria ?? "");
  const [hallazgos, setHallazgos] = useState(order?.hallazgos ?? "");
  const [recomendaciones, setRecomendaciones] = useState(order?.recomendaciones ?? "");
  const [observaciones, setObservaciones] = useState(order?.observaciones ?? "");
  const [description, setDescription] = useState(order?.description ?? "");
  /** The value the field starts at — the whole omission contract hangs on it. */
  const originalAppointmentAt = toDatetimeLocal(order?.appointmentAt);
  const [appointmentAt, setAppointmentAt] = useState(originalAppointmentAt);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * D2 — fetches the chosen customer's ACTIVE vehicles (never seeded alongside
   * the customer: `ClienteListItem.plates` is plate strings with no vehicle
   * ids). Create mode only — the vehicle is immutable post-creation, like
   * customer and parts, so an edit-mode order never needs this list.
   *
   * The list is stored KEYED by what it was fetched for, and loading/empty/
   * error are derived from that key rather than mirrored into their own
   * useStates. Mirroring is what made this a dead end twice: `resetForm` and
   * `handleCustomerSelect` emptied the list and pinned "loading", then re-set
   * `clienteId` to the value it already held — React bails out on an identical
   * value, no dependency changed, the effect never re-ran, and the dropdown
   * stayed disabled with nothing on screen explaining why. Resetting the
   * mirrors from inside the effect instead only traded that for a cascading
   * render (the `react-hooks` lint error). A key cannot fall out of sync with
   * the thing it names.
   *
   * `open` is in the deps because opening is when the list must be fresh, and
   * a closed dialog then never fetches at all. `vehiclesRetry` is there so the
   * error state's "Reintentar" is something the user can actually do:
   * re-picking the same customer is a no-op React bails on, so without a
   * dependency that always changes, only closing the dialog recovered.
   *
   * Clearing `vehiculoId` stays in the handlers — THAT is what changing the
   * customer means, and it is the form's state, not this effect's bookkeeping.
   *
   * `cancelled` guards a slow response for a customer that is no longer
   * selected from repainting over a faster later one.
   */
  useEffect(() => {
    if (isEdit || !open || !clienteId) return;
    let cancelled = false;
    const key = `${clienteId}:${vehiclesRetry}`;
    fetch(`/api/customers/${clienteId}/vehicles`)
      .then((response) => {
        // An HTTP error is an error. Folding it into `{ vehicles: [] }` is how
        // a 403 or a 500 used to reach the user as "this customer has no cars".
        if (!response.ok) throw new Error(`vehicles fetch failed: ${response.status}`);
        return response.json();
      })
      .then((body: { vehicles: Vehiculo[] }) => {
        if (!cancelled) setFetchedVehicles({ key, vehicles: body.vehicles, failed: false });
      })
      .catch(() => {
        // A failed request and an empty garage are NOT the same thing: without
        // this the customer with three cars is told to go add one. Covers both
        // halves — a rejected fetch AND a non-ok response, which the `.then`
        // above turns into a rejection precisely so this handler sees it.
        if (!cancelled) setFetchedVehicles({ key, vehicles: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [clienteId, isEdit, open, vehiclesRetry]);

  const vehiclesKey = `${clienteId}:${vehiclesRetry}`;
  const vehiclesSettled = fetchedVehicles.key === vehiclesKey;
  const vehicles = vehiclesSettled ? fetchedVehicles.vehicles : [];
  const vehiclesError = vehiclesSettled && fetchedVehicles.failed;
  const vehiclesLoading = !isEdit && Boolean(clienteId) && !vehiclesSettled;
  const showVehiclesEmptyHint = Boolean(clienteId) && !vehiclesLoading && !vehiclesError && vehicles.length === 0;

  function handleCustomerSelect(customer: ServiceOrderCustomerOption) {
    setClienteId(customer.id);
    setVehiculoId("");
    // A vehiculoId error from a rejected submit would otherwise stay on screen
    // pointing at a selection that no longer exists.
    setErrors({});
  }

  /**
   * D6 — `vehiculoId` belongs to THIS component and is keyed off the customer
   * the picker just dropped, so the picker cannot clear it. Left behind, it
   * survives to the POST and `createOrder`'s ownership check refuses it as
   * "Seleccioná un vehículo válido de este cliente" — a refusal about a
   * vehicle the operator can no longer see, let alone change.
   */
  function handleCustomerDeselect() {
    setClienteId("");
    setVehiculoId("");
    setErrors({});
  }

  function resetForm() {
    const nextClienteId = order?.clienteId ?? selectedCustomer?.id ?? "";
    setClienteId(nextClienteId);
    setVehiculoId("");
    setCategoria(order?.categoria ?? "");
    setHallazgos(order?.hallazgos ?? "");
    setRecomendaciones(order?.recomendaciones ?? "");
    setObservaciones(order?.observaciones ?? "");
    setDescription(order?.description ?? "");
    setAppointmentAt(originalAppointmentAt);
    setErrors({});
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) resetForm();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrors({});
    let saved: OrdenServicio;

    try {
      const response = isEdit
        ? await fetch(`/api/service-orders/${order!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: description.trim() || null,
              // Omitted when untouched, not sent-as-equal. `updateOrder`
              // compares getTime() to decide whether to cancel and reschedule
              // the customer's reminder, and this input has no seconds — so an
              // appointment stored at 14:30:45 would come back as 14:30:00 and
              // read as CHANGED on every save that never touched the field.
              ...(appointmentAt !== originalAppointmentAt
                ? { appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null }
                : {}),
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
              // D7 — what the CUSTOMER said at booking. `hallazgos` and
              // `recomendaciones` are findings and stay off the create wire.
              observaciones: observaciones.trim() || undefined,
              appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : undefined,
            }),
          });

      if (response.status === 400) {
        const body = await response.json();
        const returned: Record<string, string> =
          body.errors ?? { clienteId: body.error === "unknown_cliente" ? "Seleccioná un cliente válido" : body.error };
        // Only clienteId and vehiculoId have a field to render into. A 400 keyed
        // on anything else used to set state nobody displayed, so the dialog sat
        // there after Guardar saying nothing. Anything unrendered falls through
        // to the form-level slot instead of disappearing.
        const unrendered = Object.entries(returned).filter(([field]) => !RENDERED_ERROR_FIELDS.has(field));
        setErrors(
          unrendered.length > 0
            ? { ...returned, form: unrendered.map(([, message]) => message).join(" ") }
            : returned,
        );
        return;
      }

      // R20/D5 — this 409 is DETERMINISTIC, so the generic "Intentalo de nuevo"
      // below would send the operator round a loop that returns the identical
      // refusal forever, never naming the state or the one thing that unblocks
      // them. It fires in exactly one scenario, and it is the scenario the
      // server guard was written for: staff A has this picker open, staff B
      // deactivates the customer, staff A submits.
      if (response.status === 409) {
        const body = await response.json();
        setErrors({
          form:
            body.error === "cliente_deactivated"
              ? "Este cliente fue desactivado. Reactivalo para poder abrirle una orden."
              : "No se pudo guardar la orden de servicio.",
        });
        return;
      }

      if (!response.ok) {
        setErrors({ form: "No se pudo guardar la orden de servicio. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      saved = body.orden;
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, so without this the dialog re-enables with nothing on screen
      // and the operator clicks into the same silence. `UserForm` and
      // `CustomerForm` carry the same catch with the same copy. The cost is
      // highest here: a save that vanishes takes the customer, the vehicle,
      // the category and the parts cart with it.
      //
      // It covers the request and its body and nothing else — `setOpen` and
      // `onSaved` sit BELOW, so a parent's `onSaved` throwing cannot print
      // "no se pudo conectar" over an order that was actually created, onto a
      // dialog this same code has already closed.
      setErrors({ form: CONNECTION_ERROR });
      return;
    } finally {
      setIsSubmitting(false);
    }

    setOpen(false);
    onSaved?.(saved);
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
                  onDeselect={handleCustomerDeselect}
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
                  className={`${NATIVE_FIELD} h-8 px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50`}
                  value={vehiculoId}
                  disabled={!clienteId || vehiclesLoading || vehicles.length === 0}
                  aria-describedby={showVehiclesEmptyHint ? VEHICLES_EMPTY_HINT_ID : undefined}
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
                {clienteId && !vehiclesLoading && vehiclesError && (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="text-sm text-muted-foreground">
                      No pudimos cargar los vehículos de este cliente.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setVehiclesRetry((n) => n + 1)}>
                      Reintentar
                    </Button>
                  </div>
                )}
                {showVehiclesEmptyHint && (
                  <>
                    <p id={VEHICLES_EMPTY_HINT_ID} className="text-sm text-muted-foreground">
                      Este cliente no tiene vehículos activos. Agregá uno primero.
                    </p>
                    {/*
                     * D1/D4 — "agregá uno primero" used to be a dead end: 368
                     * of 370 customers have no vehicle and `vehiculoId` is NOT
                     * NULL, so the operator had to leave this dialog to open
                     * an order at all. Gated on `canCreateCustomer`, the same
                     * `customers.write` rule the picker's "Crear cliente
                     * nuevo" uses and the same Action the POST requires (D3).
                     *
                     * `VehicleQuickForm`, deliberately NOT `CustomerForm`:
                     * that one always resends `whatsappOptOut`/`emailOptOut`
                     * from form state, and `ClienteListItem` does not carry
                     * either — so reusing it here would silently overwrite a
                     * customer's consent. See its own docstring.
                     */}
                    {canCreateCustomer && (
                      <VehicleQuickForm
                        clienteId={clienteId}
                        onCreated={(newVehiculoId) => {
                          setVehiculoId(newVehiculoId);
                          // The list this dialog is holding predates the
                          // insert. Same lever "Reintentar" pulls: the fetch
                          // effect keys off `vehiclesRetry`, and re-selecting
                          // the same customer is a no-op React bails on.
                          setVehiclesRetry((n) => n + 1);
                        }}
                        // Nothing to undo: cancelling adds no vehicle, so
                        // every error already on screen is still true —
                        // including "Seleccioná un vehículo válido". Clearing
                        // them here would erase a refusal the operator has
                        // not addressed. The prop exists because placing the
                        // form is the parent's business, not because the
                        // parent has state to roll back.
                      />
                    )}
                  </>
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
                className={`${NATIVE_FIELD} h-8 px-2.5 py-1`}
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as ServiceCategory)}
              >
                {/* Create mode opens unfilled, like the vehicle field above.
                    A missing category is visible — the submit is blocked. A
                    wrong one is invisible forever, and this feature exists to
                    make the vehicle's history true. Edit mode needs no
                    placeholder: the order already has one. */}
                {!isEdit && <option value="">Seleccioná un tipo de servicio</option>}
                {CATEGORIA_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="orden-description">Descripción</Label>
              {/* Multi-line since the order is printed and handed to a
                  técnico: a single-line input hid everything past its width
                  from the person who has to read it off paper. */}
              <textarea
                id="orden-description"
                className={`${NATIVE_FIELD} min-h-16 px-2.5 py-1.5`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="orden-appointment">Fecha y hora de inicio</Label>
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
                    className={`${NATIVE_FIELD} min-h-16 px-2.5 py-1.5`}
                    value={hallazgos}
                    onChange={(e) => setHallazgos(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="orden-recomendaciones">Recomendaciones</Label>
                  <textarea
                    id="orden-recomendaciones"
                    className={`${NATIVE_FIELD} min-h-16 px-2.5 py-1.5`}
                    value={recomendaciones}
                    onChange={(e) => setRecomendaciones(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* D7 — settable at CREATION as well as on edit: this records what
                the customer asked for when the order was booked, which is
                known before anyone has looked at the vehicle. The two fields
                above it are findings, and stay edit-only. */}
            <div className="grid gap-2">
              <Label htmlFor="orden-observaciones">Observaciones</Label>
              <textarea
                id="orden-observaciones"
                className={`${NATIVE_FIELD} min-h-16 px-2.5 py-1.5`}
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </div>

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
            <Button type="submit" disabled={isSubmitting || (!isEdit && (!vehiculoId || !categoria))}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
