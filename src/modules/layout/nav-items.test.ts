import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { getNavGroups } from "./nav-items";
import type { NavGroup } from "./nav-items";

const admin: SessionUser = { id: "admin-1", role: "administrador" };
const tecnico: SessionUser = { id: "user-1", role: "tecnico" };

function labelTree(groups: NavGroup[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const g of groups) {
    result[g.label] = g.items.map((i) => (i.kind === "parent" ? `${i.label} [${i.children.map((c) => c.label).join(", ")}]` : i.label));
  }
  return result;
}

describe("getNavGroups() — grouped sidebar nav", () => {
  it("shows 3 groups to admin: CRM, Catálogo, Configuración", () => {
    const groups = getNavGroups(admin);
    expect(groups.map((g) => g.label)).toEqual(["CRM", "Catálogo", "Configuración"]);
  });

  it("shows 2 groups to técnico: CRM, Catálogo (no Configuración)", () => {
    const groups = getNavGroups(tecnico);
    expect(groups.map((g) => g.label)).toEqual(["CRM", "Catálogo"]);
  });

  it("Configuración group has pinBottom for admin", () => {
    const groups = getNavGroups(admin);
    const configGroup = groups.find((g) => g.label === "Configuración")!;
    expect(configGroup.pinBottom).toBe(true);
  });

  it("admin sees all CRM items, including Inventario per binding decision #2 (Clientes, Órdenes de servicio, Inventario)", () => {
    const groups = getNavGroups(admin);
    const crm = groups.find((g) => g.label === "CRM")!;
    expect(crm.items.map((i) => i.label)).toEqual(["Clientes", "Órdenes de servicio", "Inventario"]);
  });

  it("admin sees Catálogo items WITHOUT Inventario (Generar Catálogos, Catálogos Generados only)", () => {
    const groups = getNavGroups(admin);
    const cat = groups.find((g) => g.label === "Catálogo")!;
    expect(cat.items.map((i) => i.label)).toEqual(["Generar Catálogos", "Catálogos Generados"]);
  });

  it("Inventario is NOT present anywhere under the Catálogo group", () => {
    const groups = getNavGroups(admin);
    const cat = groups.find((g) => g.label === "Catálogo")!;
    expect(cat.items.map((i) => i.label)).not.toContain("Inventario");
  });

  it("admin sees Configuración with three children: Config. del CRM + Config. de catálogos (with nested Configuración de template) + Gestión de usuarios", () => {
    const groups = getNavGroups(admin);
    const cfg = groups.find((g) => g.label === "Configuración")!;
    expect(cfg.items).toHaveLength(3);
    expect(cfg.items[0]).toEqual({ kind: "link", href: "/workshop-config", label: "Config. del CRM", icon: "template-config", action: "workshop.edit" });
    const parent = cfg.items[1];
    expect(parent.kind).toBe("parent");
    if (parent.kind === "parent") {
      expect(parent.label).toBe("Config. de catálogos");
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].label).toBe("Configuración de template");
    }
    expect(cfg.items[2]).toEqual({ kind: "link", href: "/users", label: "Gestión de usuarios", icon: "users", action: "users.manage" });
  });

  // The entry is gated on `users.manage`, the same action /api/users and
  // /users enforce — so the link can never render for someone who would get a
  // 403 on arrival.
  it("técnico sees no Gestión de usuarios anywhere in the tree", () => {
    const labels = Object.values(labelTree(getNavGroups(tecnico))).flat().join(" ");
    expect(labels).not.toContain("Gestión de usuarios");
  });

  it("técnico's tree is unchanged by the new entry — still 2 groups, no Configuración", () => {
    const groups = getNavGroups(tecnico);
    expect(groups.map((g) => g.label)).toEqual(["CRM", "Catálogo"]);
  });

  it("técnico does NOT see Generar Catálogos (catalogs.generate denied), and Catálogo only has Catálogos Generados", () => {
    const groups = getNavGroups(tecnico);
    const cat = groups.find((g) => g.label === "Catálogo")!;
    expect(cat.items.map((i) => i.label)).toEqual(["Catálogos Generados"]);
  });

  it("técnico sees Inventario under CRM, not under Catálogo", () => {
    const groups = getNavGroups(tecnico);
    const crm = groups.find((g) => g.label === "CRM")!;
    expect(crm.items.map((i) => i.label)).toContain("Inventario");
  });

  // Total-item-count assertions are supplementary, NOT a substitute for the
  // placement assertions above — a swapped grouping between CRM/Catálogo
  // keeps these totals identical (that coincidence is exactly what let the
  // wrong grouping slip through review previously). Do not rely on these
  // alone to prove correct placement.
  it("técnico sees only 4 total items across 2 groups", () => {
    const groups = getNavGroups(tecnico);
    const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
    expect(totalItems).toBe(4);
  });

  it("admin sees 8 total items across 3 groups", () => {
    const groups = getNavGroups(admin);
    const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
    expect(totalItems).toBe(8);
  });

  // Stable ids decouple sidebar-group-collapse cookie state from display
  // labels — renaming a label (see the Generar Catálogos/Catálogos
  // Generados fix above) must not invalidate a user's saved collapse state.
  it("every top-level group exposes a stable id independent from its label", () => {
    const groups = getNavGroups(admin);
    expect(groups.map((g) => ({ label: g.label, id: g.id }))).toEqual([
      { label: "CRM", id: "crm" },
      { label: "Catálogo", id: "catalogo" },
      { label: "Configuración", id: "configuracion" },
    ]);
  });

  it("the nested 'Config. de catálogos' parent exposes a stable id for its own collapse state", () => {
    const groups = getNavGroups(admin);
    const cfg = groups.find((g) => g.label === "Configuración")!;
    const parent = cfg.items[1];
    expect(parent.kind).toBe("parent");
    if (parent.kind === "parent") {
      expect(parent.id).toBe("config-catalogos");
    }
  });
});
