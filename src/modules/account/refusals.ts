/**
 * The API answers a refused mutation with the machine reason from
 * `checkAdminSafety`. Echoing that raw code at an admin would be useless — each
 * one has a specific, actionable explanation.
 *
 * Promoted verbatim out of `UsersTable.tsx` (WU5). It now has two readers —
 * the row action's inline error and the bulk `BulkResultPanel` — and a second
 * copy would let the same refusal say one thing in the row and another in the
 * panel.
 */
export const REFUSAL_MESSAGES: Record<string, string> = {
  last_active_admin: "No se puede desactivar al último administrador activo.",
  self_deactivate: "No puedes desactivar tu propia cuenta desde esta pantalla.",
  self_role_change: "No puedes cambiar tu propio rol desde esta pantalla.",
  not_found: "Ese usuario ya no existe. Recarga la página.",
  /**
   * The one line that is NOT part of the four promoted above, and the reason
   * it is here: `request_failed` is `runSequential`'s own code for a `fetch`
   * that threw, so only the bulk path can produce it — the single-row action
   * has its own `catch` and shows `CONNECTION_ERROR` instead. Without a line
   * here, `BulkResultPanel`'s documented fallback would print the raw string
   * `request_failed` at an operator, which is exactly what a refusal map
   * exists to prevent.
   */
  request_failed: "No se pudo conectar con el servidor. Intentá de nuevo.",
};
