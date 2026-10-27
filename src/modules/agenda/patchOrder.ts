import { CONNECTION_ERROR } from "@/shared/ui/messages";

/**
 * PATCH `/api/service-orders/[id]`; resolves `null` on success or the Spanish line to show inline.
 * A refusal carries its own text as `errors.form`, `errors.appointmentAt` or `message` (the 409 stale
 * guard and the 403 role refusal), in that order. `router.refresh()` belongs to the CALLER, below this
 * try/catch: a refresh that throws must not read as a connection failure over a write the server accepted.
 */
export async function patchOrder(id: string, payload: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`/api/service-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return null;
    const body = await response.json().catch(() => null);
    return body?.errors?.form ?? body?.errors?.appointmentAt ?? body?.message ?? "No se pudo completar la acción. Intentalo de nuevo.";
  } catch {
    return CONNECTION_ERROR;
  }
}
