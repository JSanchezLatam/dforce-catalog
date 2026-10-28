/**
 * kanban/mutations.ts - the two writes the board makes. Both resolve and never throw, so a caller can
 * roll back from one place. The board refresh (`useBoardSnapshot().refresh()`) and the success toast belong to the CALLER, below its
 * try/catch: a refresh that throws must not read as a failure of a write the server already accepted.
 */
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { CONNECTION_ERROR } from "@/shared/ui/messages";

export const STALE_MOVE_ERROR = "La orden cambió mientras la mirabas. Actualizá el tablero.";

export type MoveResult = { ok: true; status: OrderStatus } | { ok: false; error: string };
export type UrgentResult = { ok: true } | { ok: false; error: string };

type Body = { error?: unknown; message?: unknown; errors?: { form?: unknown; esperaMotivo?: unknown }; orden?: { status?: unknown } } | null;

const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

/** The refusal's own Spanish line: `errors.form`, then `errors.esperaMotivo`, then `message`. */
const refusal = (body: Body, fallback: string) => text(body?.errors?.form) ?? text(body?.errors?.esperaMotivo) ?? text(body?.message) ?? fallback;

async function send(url: string, init: RequestInit): Promise<{ res: Response; body: Body } | null> {
  try {
    const res = await fetch(url, init);
    return { res, body: (await res.json().catch(() => null)) as Body };
  } catch {
    return null;
  }
}

export async function moveOrder(
  id: string,
  move: { status: OrderStatus; expectedStatus: OrderStatus; esperaMotivo?: string },
): Promise<MoveResult> {
  const sent = await send(`/api/service-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(move),
  });
  if (!sent) return { ok: false, error: CONNECTION_ERROR };
  const { res, body } = sent;
  if (res.ok) {
    // The card is placed by what the server wrote (a received order with a technician may land in `diagnosing`).
    const returned = body?.orden?.status;
    const known = (Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).find((s) => s === returned);
    // shortcut: a 2xx body without a known status is placed where it was sent; the refresh corrects it.
    return { ok: true, status: known ?? move.status };
  }
  if (res.status === 409 && body?.error === "stale_status") return { ok: false, error: STALE_MOVE_ERROR };
  return { ok: false, error: refusal(body, "No se pudo mover la orden. Intentalo de nuevo.") };
}

export async function setUrgent(id: string, on: boolean): Promise<UrgentResult> {
  const sent = await send(`/api/service-orders/${id}/urgent`, { method: on ? "POST" : "DELETE" });
  if (!sent) return { ok: false, error: CONNECTION_ERROR };
  return sent.res.ok ? { ok: true } : { ok: false, error: refusal(sent.body, "No se pudo cambiar la marca de urgente. Intentalo de nuevo.") };
}
