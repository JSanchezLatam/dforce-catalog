"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClienteListItem } from "@/modules/customers/queries";
import { normalizePhone } from "@/modules/customers/validation";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

type Errors = Partial<Record<"name" | "phone" | "form", string>>;
/** `null` = the lookup ran and did not find the customer; `undefined` = it has not run. */
type Existing = ClienteListItem | null | undefined;

/**
 * Slim "create customer" for the booking dialog: a name and a phone, nothing else. It is rendered by
 * the caller OUTSIDE the booking `<form>` (a `<form>` inside a `<form>` is invalid DOM), and its
 * submit still stops propagation because React dispatches along the React tree, not the DOM tree.
 * The 409 handling copies `CustomerForm`'s; the one difference is "Usar ese cliente", which needs the
 * existing customer's row, so it looks it up (`status=all`: a deactivated match must be visible to be refused).
 */
export function CustomerQuickForm({ canWrite, onSaved }: { canWrite: boolean; onSaved: (customer: ClienteListItem) => void }) {
  const id = useId();
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [existing, setExisting] = useState<Existing>(undefined);
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

  async function submit(allowDuplicatePhone: boolean) {
    setBusy(true);
    setErrors({});
    let saved: ClienteListItem | null = null;
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allowDuplicatePhone ? { name, phone, allowDuplicatePhone } : { name, phone }),
      });
      if (response.status === 400) {
        setErrors((await response.json()).errors ?? {});
      } else if (response.status === 409) {
        const body = await response.json();
        if (body.error === "duplicate_phone") {
          setDuplicateId(body.existingClienteId);
          setExisting(undefined);
        } else setErrors({ form: "No se pudo guardar el cliente. Intentalo de nuevo." });
      } else if (!response.ok) {
        setErrors({ form: response.status === 403 ? "No tenés permiso para crear clientes." : "No se pudo guardar el cliente. Intentalo de nuevo." });
      } else {
        saved = { ...(await response.json()).cliente, plates: [] };
      }
    } catch {
      setErrors({ form: CONNECTION_ERROR });
    } finally {
      setBusy(false);
    }
    // Below the try/catch: a throwing callback must not read as a failed save.
    if (saved) {
      addToast("success", "Cliente creado");
      onSaved(saved);
    }
  }

  /** The existing customer's row; cached after the first lookup. */
  async function lookup(): Promise<Existing> {
    if (existing !== undefined) return existing;
    setBusy(true);
    try {
      const response = await fetch(`/api/customers?search=${encodeURIComponent(normalizePhone(phone))}&pageSize=50&status=all`);
      if (!response.ok) throw new Error(`GET /api/customers failed with ${response.status}`);
      const body: { customers: ClienteListItem[] } = await response.json();
      const match = body.customers.find((c) => c.id === duplicateId) ?? null;
      setExisting(match);
      return match;
    } catch {
      setErrors({ form: "No se pudo buscar el cliente existente. Intentalo de nuevo." });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function useExisting() {
    const match = await lookup();
    if (match && !match.deactivatedAt) onSaved(match);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    return submit(false);
  }

  const unusable = existing !== undefined && (existing === null || !!existing.deactivatedAt);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Crear cliente nuevo</p>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Nombre</Label>
        <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.name}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-phone`}>Teléfono</Label>
        <Input
          id={`${id}-phone`}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            // A choice armed for the OLD phone must not apply to whatever is typed next.
            setDuplicateId(null);
            setExisting(undefined);
          }}
        />
        {errors.phone && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.phone}
          </p>
        )}
      </div>
      {errors.form && (
        <p role="alert" className={FIELD_ERROR}>
          {errors.form}
        </p>
      )}
      {duplicateId ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">Ya hay un cliente con este teléfono. Si son dos personas distintas que comparten el número, guardá igual.</p>
          {existing && (
            <p className="text-sm">
              Cliente existente: <span className="font-medium">{existing.name}</span>
              {existing.phone ? ` · ${existing.phone}` : ""}
              {existing.email ? ` · ${existing.email}` : ""}
            </p>
          )}
          {unusable && (
            <p role="alert" className="text-sm text-muted-foreground">
              {existing ? "Ese cliente está desactivado y no se puede usar para una cita." : "No se encontró al cliente existente para usarlo."} Podés guardar igual para crear uno nuevo.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={lookup}>
              Ver el cliente existente
            </Button>
            <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy || unusable} onClick={useExisting}>
              Usar ese cliente
            </Button>
            <Button type="button" variant="outline" className="min-h-11 min-w-11" disabled={busy} onClick={() => submit(true)}>
              Guardar igual
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" className="min-h-11 self-start" disabled={busy}>
          Crear cliente
        </Button>
      )}
    </form>
  );
}
