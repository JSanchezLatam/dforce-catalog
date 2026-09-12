"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Info, Pencil, Plus, RotateCcw, Save, Trash2, TriangleAlert, X } from "lucide-react";

import type { Cliente, Vehiculo } from "@/shared/db/schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import {
  CARD,
  CARD_MUTED,
  FIELD_ERROR,
  PLATE_BADGE,
  PLATE_BADGE_MUTED,
  SECTION_HEADING,
} from "@/shared/ui/styles";
import { VehicleMakeModelFields } from "./VehicleMakeModelFields";

/**
 * One vehicle row in the form. `key` is a stable, client-only React key
 * (never sent to the server); `id` is present only for a vehicle that already
 * exists in `vehiculo` — its absence is what tells `buildPayload` to send an
 * insert instead of an update (design.md D5, plates are never the key).
 * `deactivated` mirrors a real `vehiculo.deactivatedAt`, but ALSO doubles as
 * "the staff member just removed this row" for a not-yet-saved vehicle —
 * `removeOrDeactivateVehicle` below tells the two apart by `id`.
 *
 * `deleted` is a different thing again, and never a server state: it is a
 * PENDING permanent removal, staged like every other edit in this form and
 * only real once Guardar goes through. A deleted row leaves the screen but
 * stays in state, because its id is what the payload has to carry back.
 */
type VehiculoRow = {
  key: string;
  id?: string;
  plate: string;
  make: string;
  model: string;
  year: string;
  deactivated: boolean;
  deleted: boolean;
};

type CustomerFormState = {
  name: string;
  phone: string;
  email: string;
  vehicles: VehiculoRow[];
  whatsappOptOut: boolean;
  emailOptOut: boolean;
};

/**
 * NOT `crypto.randomUUID()`, and it must not go back to it: that method exists
 * only in a SECURE CONTEXT (HTTPS, or localhost/127.0.0.1). The workshop
 * reaches this app from other machines over `http://192.168.x.x:3000`, where
 * `crypto` is defined but `randomUUID` is not — "Agregar vehículo" threw
 * `TypeError: crypto.randomUUID is not a function` there while working
 * perfectly on every developer's localhost.
 *
 * A counter is enough because this key is never an identity: it is a React key,
 * unique only among one form's rows, and it never reaches the server. The
 * `new-` prefix is what keeps it clear of the database uuids `toFormState`
 * gives already-saved rows.
 */
let nextVehicleRowKey = 0;

function emptyVehicleRow(): VehiculoRow {
  return { key: `new-${nextVehicleRowKey++}`, plate: "", make: "", model: "", year: "", deactivated: false, deleted: false };
}

/**
 * `vehicles` is honoured only in edit mode, as the prop's own docstring
 * promises. Enforced here rather than trusted: in create mode those rows would
 * carry ids belonging to some other customer, `buildPayload` would POST them,
 * and `planVehiculoReconcile` would reject the whole request as foreign-id
 * ownership. No caller does that today — which is exactly why the guard is one
 * line now instead of a bug report later.
 */
function toFormState(cliente?: Cliente | null, allVehicles?: Vehiculo[] | null): CustomerFormState {
  const vehicles = cliente ? allVehicles : null;
  return {
    name: cliente?.name ?? "",
    phone: cliente?.phone ?? "",
    email: cliente?.email ?? "",
    vehicles: (vehicles ?? []).map((v) => ({
      key: v.id,
      id: v.id,
      plate: v.plate,
      make: v.make ?? "",
      model: v.model ?? "",
      year: v.year != null ? String(v.year) : "",
      deactivated: v.deactivatedAt !== null,
      deleted: false,
    })),
    whatsappOptOut: cliente?.whatsappOptOut ?? false,
    emailOptOut: cliente?.emailOptOut ?? false,
  };
}

/** Active rows in submission order — the index a server-side `vehicles.<i>.<field>` error refers to. */
function activeVehicles(vehicles: VehiculoRow[]) {
  return vehicles.filter((v) => !v.deleted && !v.deactivated);
}

/** Everything still on screen. A row staged for permanent deletion leaves the UI the moment it is confirmed. */
function visibleVehicles(vehicles: VehiculoRow[]) {
  return vehicles.filter((v) => !v.deleted);
}

/** Saved rows staged for permanent removal — only these carry an id worth sending. */
function deletedVehicles(vehicles: VehiculoRow[]) {
  return vehicles.filter((v) => v.deleted);
}

/** Sends `undefined` (omitted) for blank optional fields — matches validation.ts's `trimmedOrUndefined`. */
function buildPayload(form: CustomerFormState) {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email.trim() || undefined,
    // Two routes reach `plan.deactivate`, and this form uses the first:
    // deactivated rows are OMITTED, so the server infers "deactivate" from a
    // previously-active vehicle's id being absent from this array (design.md
    // D5). The same omission covers a never-saved row removed before it was
    // ever sent. The second route — `deactivated: true` on a row that IS
    // present — exists for other callers; this form never needs it.
    //
    // `deactivated: false` on an existing row is this form ASKING for the
    // vehicle to be active. The server never infers a restore from a row
    // merely being present: `VehiculoInput.deactivated` is tri-state and
    // OMITTED means "leave this vehicle's state alone", which is what makes
    // an unchanged resend a no-op for any client (vehicles.ts). An insert has
    // no state to restore, so it carries no flag.
    // Permanent deletions ride at the END of the array on purpose: every
    // `vehicles.<i>.<field>` error key the server can return is a position in
    // this array, and appending keeps each surviving row's index exactly where
    // the active list put it.
    vehicles: [
      ...activeVehicles(form.vehicles).map((v) => ({
        ...(v.id !== undefined ? { id: v.id, deactivated: false } : {}),
        plate: v.plate.trim(),
        make: v.make.trim() || undefined,
        model: v.model.trim() || undefined,
        year: v.year.trim() ? Number(v.year) : undefined,
      })),
      // A delete addresses the row by id; no other column survives it.
      ...deletedVehicles(form.vehicles).map((v) => ({ id: v.id!, deleted: true })),
    ],
    whatsappOptOut: form.whatsappOptOut,
    emailOptOut: form.emailOptOut,
  };
}

/**
 * R16/R17/R18/R26 — create/edit `cliente`. `"use client"`, `useState` for
 * fields + `errors`, shadcn `Dialog`+`Input`+`Label`+`Button`+`Checkbox`,
 * `FIELD_ERROR` for messages — mirrors `CatalogBuilderForm.tsx`'s error
 * handling and `TemplateConfigForm.tsx`'s controlled-input shape. POSTs to
 * `/api/customers` (create) or PATCHes `/api/customers/[id]` (edit, when
 * `cliente` is supplied) — the two routes from tasks 5.1/5.2.
 *
 * Vehicles (vehicles-one-to-many, C3): a repeating card group, not four flat
 * inputs. `vehicles` — the customer's WHOLE collection, active and inactive
 * (`getClienteById` fetches both) — is what makes restore possible: a
 * deactivated vehicle stays on screen, visibly secondary, with its own
 * restore action, rather than a hidden-by-default list (`UsersTable`'s
 * `showInactive` toggle is the right idiom for a many-row admin table; one
 * customer's handful of vehicles is small enough to just always show).
 */
export function CustomerForm({
  cliente,
  vehicles,
  canDeleteVehicle = false,
  triggerLabel,
  onSaved,
}: {
  /** Provided => edit mode (PATCH); omitted => create mode (POST). */
  cliente?: Cliente | null;
  /** The customer's whole vehicle collection (active + inactive) — ignored in create mode. */
  vehicles?: Vehiculo[] | null;
  /**
   * `customers.deleteVehicle` — administrador-only. Deactivation stays
   * available to everyone who can edit a customer; destroying the row does
   * not. Defaults to DENY so a caller that forgets to pass it hides the
   * control rather than showing an unauthorized destructive button; the API
   * refuses the request regardless (`api/customers/[id]/route.ts`), this only
   * keeps a button that would always 403 off the screen.
   */
  canDeleteVehicle?: boolean;
  triggerLabel?: ReactNode;
  /** `plates` is exactly what this save just sent — the API's 201/200 body carries no `vehicles`/`plates` of its own. */
  onSaved?: (cliente: Cliente, plates: string[]) => void;
}) {
  const isEdit = Boolean(cliente);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(() => toFormState(cliente, vehicles));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The row a destructive confirmation is open for — `null` means no confirmation on screen. */
  const [pendingDelete, setPendingDelete] = useState<VehiculoRow | null>(null);
  /**
   * R18 (rewritten) — the id of the customer who already holds this phone,
   * set by a `409` and cleared by anything that changes the question: editing
   * the phone, or reopening the dialog. `null` means no refusal on screen.
   *
   * This is what arms the override, so its lifetime IS the guarantee that the
   * confirmation answers one attempt and no other. Held here rather than in
   * `errors` because it drives a link and a button, not a message.
   */
  const [sharedPhoneWith, setSharedPhoneWith] = useState<string | null>(null);

  function update<K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateVehicle(rowKey: string, patch: Partial<VehiculoRow>) {
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.key === rowKey ? { ...v, ...patch } : v)),
    }));
  }

  /**
   * Every `vehicles.<i>.*` error key is a position in the array the LAST submit
   * sent, and these three functions change what that array contains. A 400
   * leaves the dialog open holding those keys; recomputing positions without
   * dropping them repaints a stale error onto whichever car now sits at that
   * index. `handleSubmit` clears on the next submit and `handleOpenChange` on
   * open — neither fires here.
   */
  function clearVehicleIndexedErrors() {
    // Only the `vehicles.<i>.*` keys — those are the ones a membership change
    // invalidates. `errors.name`/`errors.phone`/`errors.form` are still true
    // and survive, so fixing the vehicle rows does not silently drop the
    // message about the phone the staff member has yet to correct.
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith("vehicles."))));
  }

  function addVehicle() {
    clearVehicleIndexedErrors();
    setForm((prev) => ({ ...prev, vehicles: [...prev.vehicles, emptyVehicleRow()] }));
  }

  /** A never-saved row (`id` undefined) is dropped outright; an existing one is marked deactivated (soft delete, D5). */
  function removeOrDeactivateVehicle(rowKey: string) {
    clearVehicleIndexedErrors();
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.flatMap((v) => {
        if (v.key !== rowKey) return [v];
        return v.id === undefined ? [] : [{ ...v, deactivated: true }];
      }),
    }));
  }

  /**
   * The destructive twin of `removeOrDeactivateVehicle`, and deliberately a
   * separate action rather than a mode of it: "Quitar" means the car left the
   * customer and its service history has to survive; this means the row should
   * never have existed. Confirmed first (`pendingDelete`) because it cannot be
   * undone — `ConfirmGenerateDialog` is this repo's idiom for that.
   *
   * A never-saved row has no server row to remove, so it is simply dropped,
   * exactly as `removeOrDeactivateVehicle` already drops it. A saved one is
   * staged: off the screen, still in state, its id sent as `deleted: true` on
   * Guardar. Nothing is destroyed until that save succeeds.
   */
  function deleteVehicle(rowKey: string) {
    clearVehicleIndexedErrors();
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.flatMap((v) => {
        if (v.key !== rowKey) return [v];
        return v.id === undefined ? [] : [{ ...v, deleted: true }];
      }),
    }));
  }

  function restoreVehicle(rowKey: string) {
    clearVehicleIndexedErrors();
    setForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.key === rowKey ? { ...v, deactivated: false } : v)),
    }));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPendingDelete(null);
    if (next) {
      setForm(toFormState(cliente, vehicles));
      setErrors({});
      setSharedPhoneWith(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // `stopPropagation` is load-bearing, not defensive. React dispatches
    // events along the REACT tree, not the DOM tree, so this dialog being
    // portalled out of the DOM does NOT take it out of the ancestor form's
    // event path. This component renders inside `CustomerPicker`, which
    // renders inside `ServiceOrderForm`'s own `<form onSubmit>` — measured in
    // jsdom, an inner submit fired the OUTER handler twice, so saving a new
    // customer from the order dialog also created the order.
    event.stopPropagation();
    // A plain save never carries the override — it has to be asked for.
    return submit(false);
  }

  /**
   * `confirmSharedPhone` is passed per call rather than read from
   * `sharedPhoneWith`, so the flag can only ride a save the operator started
   * from the confirmation button itself.
   */
  async function submit(confirmSharedPhone: boolean) {
    setIsSubmitting(true);
    setErrors({});
    let saved: Cliente;

    try {
      const payload = buildPayload(form);
      const response = await fetch(isEdit ? `/api/customers/${cliente!.id}` : "/api/customers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmSharedPhone ? { ...payload, allowDuplicatePhone: true } : payload),
      });

      if (response.status === 400) {
        const body = await response.json();
        setErrors(body.errors ?? {});
        return;
      }

      if (response.status === 409) {
        const body = await response.json();
        // TWO different 409s reach here now, and branching on the body is what
        // keeps them apart. `cliente_deactivated` (R20) carries no
        // `existingClienteId`, so the previous unconditional
        // `setSharedPhoneWith(body.existingClienteId)` armed `undefined` — the
        // block below stayed hidden, `errors` had been cleared at the top of
        // this function, and the dialog just sat there saying nothing.
        //
        // That path is exactly the one D5 exists for: staff A opens the detail
        // page while the customer is active, staff B deactivates them, staff A
        // saves. Hiding "Editar" removes the FRESH path and does nothing for
        // the stale one, which is the only one the 409 was written to catch.
        if (body.error === "duplicate_phone") {
          // No `errors.phone`: the refusal renders its own block below, with
          // the link and the way past it. Setting both would print the same
          // fact twice, once as an error the operator cannot act on.
          setSharedPhoneWith(body.existingClienteId);
        } else {
          // Disarm, don't just add a message. Reachable: a `duplicate_phone`
          // 409 arms the block, the customer is deactivated, the operator
          // clicks "Guardar igual" and gets `cliente_deactivated`. Without
          // this both blocks render and "Guardar igual" stays clickable
          // against a save that can never succeed.
          setSharedPhoneWith(null);
          setErrors({
            form: "Este cliente fue desactivado y no se puede editar. Reactivalo primero.",
          });
        }
        return;
      }

      if (!response.ok) {
        setErrors({ form: "No se pudo guardar el cliente. Intentalo de nuevo." });
        return;
      }

      const body = await response.json();
      saved = body.cliente;
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, so without this the dialog re-enables with nothing on screen
      // and the operator clicks into the same silence. `UserForm` carries the
      // same catch for the same reason. It matters twice here: "Guardar igual"
      // calls this from a click handler, with no form submission behind it to
      // surface anything.
      //
      // It covers the request and its body and nothing else: `setOpen`/
      // `onSaved` moved BELOW, so a parent's `onSaved` throwing can no longer
      // print "no se pudo conectar" over a save that actually succeeded — onto
      // a dialog this same code has already closed, where nobody would read it.
      setErrors({ form: CONNECTION_ERROR });
      return;
    } finally {
      setIsSubmitting(false);
    }

    setOpen(false);
    // Active rows only — a deletion entry is an id with no plate to report.
    onSaved?.(saved, activeVehicles(form.vehicles).map((v) => v.plate.trim()));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* One size for every button in this module, `default` (h-8) — the
          trigger used to be `sm` in edit mode, which is why "Editar" sat 4px
          shorter than the "Desactivar" beside it on the detail page. */}
      <DialogTrigger render={<Button variant={isEdit ? "outline" : "default"} size="default" className="min-h-11 min-w-11" />}>
        {isEdit ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
        {triggerLabel ?? (isEdit ? "Editar" : "Nuevo cliente")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>

        {/* `min-h-0 flex-1` is what lets the `DialogBody` inside it actually
            scroll: the form is the flex child `DialogContent`'s 85vh cap
            applies to, and a flex item's default `min-height: auto` would
            refuse to shrink below its content. */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cliente-name">Nombre</Label>
              <Input id="cliente-name" value={form.name} onChange={(e) => update("name", e.target.value)} />
              {errors.name && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.name}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cliente-phone">Teléfono</Label>
              <Input
                id="cliente-phone"
                value={form.phone}
                onChange={(e) => {
                  update("phone", e.target.value);
                  // Correcting the number is the other way out of the refusal.
                  // Clearing here is what stops a confirmation armed for the
                  // OLD phone from applying to whatever is typed next.
                  setSharedPhoneWith(null);
                }}
              />
              {errors.phone && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.phone}
                </p>
              )}
              {sharedPhoneWith && (
                // `role="alert"` sits on the PARAGRAPH, and nothing focusable
                // goes inside it: a live region announces changed TEXT, and the
                // two ways past this refusal — the link and the button — are
                // not text. Keeping the paragraph text-only is what leaves
                // their own semantics intact.
                // Block-level, so it gets the box: the refusal is about the
                // save, and it carries two controls of its own. The NEUTRAL
                // variant, not destructive — a shared number between two real
                // people is a question, not an error, and the way past it is
                // right here.
                <Alert>
                  <Info aria-hidden="true" />
                  <div className="flex flex-col items-start gap-2">
                    <p role="alert" className="text-sm">
                      Ya hay un cliente con este teléfono. Si son dos personas distintas que comparten el
                      número, guardá igual.
                    </p>
                    {/* `Link`, not a raw <a>: repo convention, and it skips a
                        full document reload. It does NOT preserve what the
                        operator typed — navigating away unmounts this dialog
                        either way. Opening the existing customer beside the form
                        would, and is the more useful behaviour when the point is
                        comparing two people who share a number; nobody has asked
                        for it. */}
                    <Link href={`/customers/${sharedPhoneWith}`} className="text-sm font-medium underline">
                      Ver el cliente existente
                    </Link>
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      // 44x44 hit target — see AGENTS.md. Every action control in
                      // this module carries it; the filter strip does not, on purpose.
                      className="min-h-11 min-w-11"
                      disabled={isSubmitting}
                      onClick={() => submit(true)}
                    >
                      <Save aria-hidden="true" />
                      Guardar igual
                    </Button>
                  </div>
                </Alert>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cliente-email">Email</Label>
              <Input
                id="cliente-email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
              {errors.email && (
                <p role="alert" className={FIELD_ERROR}>
                  {errors.email}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className={SECTION_HEADING}>Vehículos</h3>
              {indexedVehicleRows(visibleVehicles(form.vehicles)).map(({ row, index, sentIndex }) => {
                // A deactivated vehicle is not editable and is not the row the
                // staff member came here for: it collapses to plate + state +
                // the way back, on a muted surface, so the vehicles actually in
                // service are the ones carrying the visual weight. The row
                // number lives in `aria-label` only — it is a unique handle for
                // assistive tech and tests, not copy anyone should have to read.
                if (row.deactivated) {
                  return (
                    <div
                      key={row.key}
                      role="group"
                      aria-label={`Vehículo ${index}`}
                      className={CARD_MUTED + " flex flex-wrap items-center justify-between gap-2"}
                    >
                      <div className="flex items-center gap-2">
                        <span className={PLATE_BADGE_MUTED}>{row.plate.trim() || "Sin placa"}</span>
                        <span className="text-xs font-medium">Vehículo desactivado</span>
                      </div>
                      {/* Both actions in one group so they wrap together to a
                          right-aligned second line: with `ml-auto` on the
                          first button alone, the second wrapped by itself and
                          overflowed the row.

                          `ml-auto` here AND `justify-between` on the parent are
                          not redundant, they cover different cases. Unwrapped,
                          `justify-between` splits plate-left / actions-right.
                          Wrapped, this group is the only item on its line and
                          `justify-between` would put it at the start — `ml-auto`
                          is what still pushes it right. */}
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          className="min-h-11 min-w-11"
                          aria-label={`Restaurar vehículo ${index}`}
                          onClick={() => restoreVehicle(row.key)}
                        >
                          <RotateCcw aria-hidden="true" />
                          Restaurar
                        </Button>
                        {/* Offered here too: a plate typed wrong and then quitado
                            is exactly the row that should never have existed, and
                            without this it would stay on the customer forever. */}
                        {canDeleteVehicle && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="default"
                            className="min-h-11 min-w-11"
                            aria-label={`Eliminar vehículo ${index} definitivamente`}
                            onClick={() => setPendingDelete(row)}
                          >
                            <Trash2 aria-hidden="true" />
                            Eliminar definitivamente
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                }

                const plateError = sentIndex >= 0 ? errors[`vehicles.${sentIndex}.plate`] : undefined;
                return (
                  <div key={row.key} role="group" aria-label={`Vehículo ${index}`} className={CARD + " flex flex-col gap-3"}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={PLATE_BADGE}>{row.plate.trim() || "Sin placa"}</span>
                      {/* Two removals, two very different meanings, so the copy
                          carries the difference rather than an icon: the soft one
                          stays the plain "Quitar" a staff member already knows,
                          the irreversible one says so in full and wears the
                          destructive variant. */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="default"
                          className="min-h-11 min-w-11"
                          aria-label={`Quitar vehículo ${index}`}
                          onClick={() => removeOrDeactivateVehicle(row.key)}
                        >
                          <X aria-hidden="true" />
                          Quitar
                        </Button>
                        {canDeleteVehicle && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="default"
                            className="min-h-11 min-w-11"
                            aria-label={`Eliminar vehículo ${index} definitivamente`}
                            onClick={() => setPendingDelete(row)}
                          >
                            <Trash2 aria-hidden="true" />
                            Eliminar definitivamente
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor={`${row.key}-plate`}>Placa</Label>
                        <Input
                          id={`${row.key}-plate`}
                          value={row.plate}
                          onChange={(e) => updateVehicle(row.key, { plate: e.target.value })}
                        />
                      </div>
                      <VehicleMakeModelFields
                        idPrefix={row.key}
                        make={row.make}
                        model={row.model}
                        onChange={(next) => updateVehicle(row.key, next)}
                      />
                      <div className="grid gap-2">
                        <Label htmlFor={`${row.key}-year`}>Año</Label>
                        <Input
                          id={`${row.key}-year`}
                          type="number"
                          value={row.year}
                          onChange={(e) => updateVehicle(row.key, { year: e.target.value })}
                        />
                      </div>
                    </div>

                    {plateError && (
                      <p role="alert" className={FIELD_ERROR}>
                        {plateError}
                      </p>
                    )}
                  </div>
                );
              })}
              {/* `validateVehiculosInput` and `planVehiculoReconcile` both throw
                  under the bare `vehicles` key (a non-list payload, a foreign
                  vehicle id). With no slot for it the dialog just sat there
                  after Guardar with nothing on screen.

                  Boxed because it is about the vehicle COLLECTION, not about
                  one input — the `vehicles.<i>.plate` message under each card
                  stays plain red text. */}
              {errors.vehicles && (
                <Alert role="alert" variant="destructive">
                  <TriangleAlert aria-hidden="true" />
                  <span>{errors.vehicles}</span>
                </Alert>
              )}
              <Button type="button" variant="outline" size="default" className="min-h-11 min-w-11 self-start" onClick={addVehicle}>
                <Plus aria-hidden="true" />
                Agregar vehículo
              </Button>
            </div>

            {/* R26 — two independent per-channel opt-out flags, re-checked at reminder fire time. */}
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Checkbox
                  checked={form.whatsappOptOut}
                  onCheckedChange={(checked) => update("whatsappOptOut", checked === true)}
                />
                No enviar recordatorios por WhatsApp
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Checkbox
                  checked={form.emailOptOut}
                  onCheckedChange={(checked) => update("emailOptOut", checked === true)}
                />
                No enviar recordatorios por email
              </label>
            </div>

            {/* FORM-level — it is about the save, not about any one input, so
                it is the one message in this dialog that gets the red box. */}
            {errors.form && (
              <Alert role="alert" variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <span>{errors.form}</span>
              </Alert>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" size="default" className="min-h-11 min-w-11" disabled={isSubmitting} />}>
              <X aria-hidden="true" />
              Cancelar
            </DialogClose>
            <Button type="submit" size="default" className="min-h-11 min-w-11" disabled={isSubmitting}>
              <Save aria-hidden="true" />
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>

        {/* Destructive and irreversible, so it asks first — the same shape
            `ConfirmGenerateDialog` uses (no close X, the safe action first,
            the consequence spelled out above both). `account`'s user
            deactivation asks nothing, correctly: that one is reversible. */}
        <Dialog open={pendingDelete !== null} onOpenChange={(next) => !next && setPendingDelete(null)}>
          <DialogContent showCloseButton={false} className="max-w-md">
            <DialogTitle>Eliminar vehículo definitivamente</DialogTitle>
            {/* A plain div, not `DialogBody`: two fixed paragraphs can never
                outgrow the cap, and a scroll container that can never scroll is
                structure pretending to do something. */}
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>
                Se va a borrar el vehículo {pendingDelete?.plate.trim() || "sin placa"} de este cliente. Esta
                acción no se puede deshacer.
              </p>
              <p>
                Si el auto simplemente ya no está con el cliente, usá Quitar: queda desactivado y se conserva
                su historial de servicio.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="default"
                className="min-h-11 min-w-11"
                aria-label="Cancelar eliminación"
                onClick={() => setPendingDelete(null)}
              >
                <X aria-hidden="true" />
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="default"
                className="min-h-11 min-w-11"
                onClick={() => {
                  if (pendingDelete) deleteVehicle(pendingDelete.key);
                  setPendingDelete(null);
                }}
              >
                <Trash2 aria-hidden="true" />
                Eliminar definitivamente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/** Pairs EVERY row with its 1-based display index and its index within the ACTIVE-only array the server sees (-1 for a deactivated row, which has no server-side error slot). Filtering is `activeVehicles`' job. */
function indexedVehicleRows(vehicles: VehiculoRow[]) {
  let sentIndex = -1;
  return vehicles.map((row, i) => {
    if (!row.deactivated) sentIndex += 1;
    return { row, index: i + 1, sentIndex: row.deactivated ? -1 : sentIndex };
  });
}
