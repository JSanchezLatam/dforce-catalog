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

  it("admin sees all CRM items", () => {
    const groups = getNavGroups(admin);
    const crm = groups.find((g) => g.label === "CRM")!;
    expect(crm.items.map((i) => i.label)).toEqual(["Clientes", "Órdenes de servicio"]);
  });

  it("admin sees all Catálogo items including Generar Catálogo", () => {
    const groups = getNavGroups(admin);
    const cat = groups.find((g) => g.label === "Catálogo")!;
    expect(cat.items.map((i) => i.label)).toEqual(["Inventario", "Generar Catálogo", "Catálogos"]);
  });

  it("admin sees Configuración with two children: Config. del CRM + Config. de catálogos (with nested Configuración de template)", () => {
    const groups = getNavGroups(admin);
    const cfg = groups.find((g) => g.label === "Configuración")!;
    expect(cfg.items).toHaveLength(2);
    expect(cfg.items[0]).toEqual({ kind: "link", href: "/workshop-config", label: "Config. del CRM", icon: "template-config", action: "workshop.edit" });
    const parent = cfg.items[1];
    expect(parent.kind).toBe("parent");
    if (parent.kind === "parent") {
      expect(parent.label).toBe("Config. de catálogos");
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].label).toBe("Configuración de template");
    }
  });

  it("técnico does NOT see Generar Catálogo (catalogs.generate denied)", () => {
    const groups = getNavGroups(tecnico);
    const cat = groups.find((g) => g.label === "Catálogo")!;
    expect(cat.items.map((i) => i.label)).toEqual(["Inventario", "Catálogos"]);
  });

  it("técnico sees only 4 total items across 2 groups", () => {
    const groups = getNavGroups(tecnico);
    const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
    expect(totalItems).toBe(4);
  });

  it("admin sees 7 total items across 3 groups", () => {
    const groups = getNavGroups(admin);
    const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
    expect(totalItems).toBe(7);
  });
});
