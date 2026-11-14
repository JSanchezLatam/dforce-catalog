import type { Role } from "@/modules/auth/roles";

export type RoleGroup = "gestion" | "tecnico";

const GROUPS: Partial<Record<Role, RoleGroup>> = {
  administrador: "gestion",
  jefe_taller: "gestion",
  tecnico: "tecnico",
};

/** The only identity a view keeps. Null = not countable (`pantalla`, the big-screen account). */
export function roleGroupOf(role: Role): RoleGroup | null {
  return GROUPS[role] ?? null;
}
