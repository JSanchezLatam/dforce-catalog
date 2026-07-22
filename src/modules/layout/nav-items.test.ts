import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { getNavItems } from "./nav-items";

const admin: SessionUser = { id: "admin-1", role: "administrador" };
const user: SessionUser = { id: "user-1", role: "usuario" };

describe("getNavItems() — Sidebar nav visibility (confirmed mockup: gate, don't just hide)", () => {
  it("shows all 4 items to an administrador, including Configuración de Template", () => {
    const items = getNavItems(admin);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.label)).toContain("Configuración de Template");
  });

  it("shows only 3 items to a usuario — Configuración de Template is absent, not disabled", () => {
    const items = getNavItems(user);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.label)).not.toContain("Configuración de Template");
  });

  it("always includes Inventario, Generar Catálogo and Catálogos regardless of role", () => {
    const always = ["Inventario", "Generar Catálogo", "Catálogos"];
    expect(getNavItems(user).map((i) => i.label)).toEqual(always);
    expect(getNavItems(admin).map((i) => i.label)).toEqual([...always, "Configuración de Template"]);
  });
});
