import type { Role } from "./roles";

/** Where a role belongs after `/` or a login: the big-screen account never sees the app shell. */
export function landingPathFor(role: Role): string {
  return role === "pantalla" ? "/tablero/clientes" : "/inventory";
}
