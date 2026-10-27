export const ROLES = ["tecnico", "jefe_taller", "pantalla", "administrador"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  tecnico: "Técnico",
  jefe_taller: "Jefe de taller",
  pantalla: "Pantalla",
  administrador: "Administrador",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
