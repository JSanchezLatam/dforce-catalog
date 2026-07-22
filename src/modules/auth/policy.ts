import type { SessionUser } from "./session";

/**
 * Single policy seam (R9.6, NFR-8) — hand-rolled, no RBAC library. Callers
 * never branch on `user.role` directly; adding a role/action means editing
 * only this file.
 */
export type Action = "sync.manual" | "template.edit" | "catalogs.listAll";

const ADMIN_ONLY_ACTIONS: ReadonlySet<Action> = new Set([
  "sync.manual",
  "template.edit",
  "catalogs.listAll",
]);

export function can(user: SessionUser, action: Action): boolean {
  if (ADMIN_ONLY_ACTIONS.has(action)) {
    return user.role === "administrador";
  }
  return true;
}
