import { describe, expect, it } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { getNavGroups } from "./nav-items";
import type { NavGroup } from "./nav-items";
import { filterNavGroups, firstHref, highlight } from "./nav-search";

const admin: SessionUser = { id: "admin-1", role: "administrador" };
const tecnico: SessionUser = { id: "user-1", role: "tecnico" };

function tree(groups: NavGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of groups) {
    out[g.label] = g.items.map((i) => (i.kind === "parent" ? `${i.label} [${i.children.map((c) => c.label).join(", ")}]` : i.label));
  }
  return out;
}

describe("filterNavGroups()", () => {
  const groups = getNavGroups(admin);

  it("returns the input unchanged for a blank query", () => {
    expect(filterNavGroups(groups, "")).toBe(groups);
    expect(filterNavGroups(groups, "   ")).toBe(groups);
  });

  it("a child match keeps the parent with only the matching children", () => {
    expect(tree(filterNavGroups(groups, "pantalla"))).toEqual({ Taller: ["Tablero [Pantalla del taller, Pantalla de clientes]"] });
  });

  it("a parent label match keeps every child", () => {
    expect(tree(filterNavGroups(groups, "tablero"))).toEqual({
      Taller: ["Tablero [Órdenes en curso, Pantalla del taller, Pantalla de clientes]"],
    });
  });

  it("drops groups with no match and ignores case and accents", () => {
    expect(tree(filterNavGroups(groups, "VEN"))).toEqual({ CRM: ["Vencimientos", "Inventario"] });
    expect(tree(filterNavGroups(groups, "ordenes")).CRM).toEqual(["Órdenes de servicio"]);
  });

  it("does not match group labels", () => {
    const synthetic: NavGroup[] = [{ id: "zeta", label: "Zeta", items: [{ kind: "link", href: "/a", label: "Alfa", icon: "board" }] }];
    expect(filterNavGroups(synthetic, "zeta")).toEqual([]);
  });

  it("never reveals a link the viewer cannot see (técnico, 'usuarios')", () => {
    expect(filterNavGroups(getNavGroups(tecnico), "usuarios")).toEqual([]);
  });
});

describe("firstHref()", () => {
  const groups = getNavGroups(admin);

  it("follows display order, through parents", () => {
    expect(firstHref(filterNavGroups(groups, "clien"))).toBe("/tablero/clientes");
    expect(firstHref(filterNavGroups(groups, "vencimientos"))).toBe("/vencimientos");
  });

  it("is undefined with no groups", () => {
    expect(firstHref([])).toBeUndefined();
  });
});

describe("highlight()", () => {
  it("splits the label around the folded match, keeping original accents", () => {
    expect(highlight("Órdenes en curso", "ordenes")).toEqual({ before: "", match: "Órdenes", after: " en curso" });
    expect(highlight("Pantalla del taller", "DEL")).toEqual({ before: "Pantalla ", match: "del", after: " taller" });
  });

  it("is null for a blank query or no match", () => {
    expect(highlight("Agenda", "")).toBeNull();
    expect(highlight("Agenda", "zzz")).toBeNull();
  });
});
