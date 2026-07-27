export const ROLES = ["tecnico", "administrador"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  tecnico: "Técnico",
  administrador: "Administrador",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
