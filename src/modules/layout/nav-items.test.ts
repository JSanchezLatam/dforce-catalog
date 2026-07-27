import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { getNavItems } from "./nav-items";

const admin: SessionUser = { id: "admin-1", role: "administrador" };
const user: SessionUser = { id: "user-1", role: "usuario" };

describe("getNavItems() — Sidebar nav visibility (confirmed mockup: gate, don't just hide)", () => {
  it("shows all 6 items to an administrador, including Configuración de Template", () => {
    const items = getNavItems(admin);
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.label)).toContain("Configuración de Template");
  });

  it("shows only 5 items to a usuario — Configuración de Template is absent, not disabled", () => {
    const items = getNavItems(user);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.label)).not.toContain("Configuración de Template");
  });

  it("always includes Inventario, Generar Catálogo, Catálogos, Clientes and Órdenes de servicio regardless of role (design.md §7 — staff-only via requireSession, no admin sub-gate)", () => {
    const always = ["Inventario", "Generar Catálogo", "Catálogos", "Clientes", "Órdenes de servicio"];
    expect(getNavItems(user).map((i) => i.label)).toEqual(always);
    expect(getNavItems(admin).map((i) => i.label)).toEqual([...always, "Configuración de Template"]);
  });
});
