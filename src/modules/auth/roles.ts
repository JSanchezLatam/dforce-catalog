export const ROLES = ["tecnico", "jefe_taller", "administrador"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  tecnico: "Técnico",
  jefe_taller: "Jefe de taller",
  administrador: "Administrador",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
