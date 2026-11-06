import { describe, expect, it } from "vitest";

import { orderStatusEnum } from "@/shared/db/schema";
import { blockedMoveReason, statusBarHint, workLinesHint } from "./hints";
import type { OrderAssignee } from "./order-team";
import { AUTOMATIC_TARGETS, isAllowedTransition, type OrderStatus } from "./transitions";

const assignee = (nombre: string, over: Partial<OrderAssignee> = {}): OrderAssignee => ({
  tecnicoId: `t-${nombre}`,
  nombre,
  active: true,
  parteLista: false,
  ...over,
});

describe("blockedMoveReason", () => {
  it("open -> diagnosing passes by itself on assigning", () => {
    expect(blockedMoveReason("open", "diagnosing")).toBe("Pasa sola al asignar un técnico");
  });
  it("in_progress -> ready_for_review passes by itself on the last mark", () => {
    expect(blockedMoveReason("in_progress", "ready_for_review")).toBe("Pasa sola cuando todos marcan su parte lista");
  });
  it("booked -> diagnosing has no edge, so it is NOT 'Pasa sola'", () => {
    expect(blockedMoveReason("booked", "diagnosing")).toBe("Desde Agendada no se puede pasar a En diagnóstico");
  });
  it("diagnosing -> ready_for_review has no edge, so it is NOT 'Pasa sola'", () => {
    expect(blockedMoveReason("diagnosing", "ready_for_review")).toBe(
      "Desde En diagnóstico no se puede pasar a Lista para revisión",
    );
  });
  it("open -> in_progress says it cannot", () => {
    expect(blockedMoveReason("open", "in_progress")).toBe("Desde Recibida no se puede pasar a En progreso");
  });
  it("in_progress -> diagnosing (no edge) says it cannot", () => {
    expect(blockedMoveReason("in_progress", "diagnosing")).toBe("Desde En progreso no se puede pasar a En diagnóstico");
  });
  it("has an automatic text for every automatic target and no other", () => {
    for (const to of orderStatusEnum.enumValues) {
      const hasText = ["open", "in_progress"].some((from) => blockedMoveReason(from as OrderStatus, to).startsWith("Pasa sola"));
      expect(hasText, to).toBe(AUTOMATIC_TARGETS.has(to));
    }
  });
  it("uses the 'Pasa sola' text exactly for the allowed automatic edges, over every pair", () => {
    for (const from of orderStatusEnum.enumValues) {
      for (const to of orderStatusEnum.enumValues) {
        const auto = (to === "diagnosing" || to === "ready_for_review") && isAllowedTransition(from, to);
        expect(blockedMoveReason(from, to).startsWith("Pasa sola"), `${from} -> ${to}`).toBe(auto);
      }
    }
  });
});

describe("statusBarHint", () => {
  const base = {
    status: "open" as OrderStatus,
    missing: [] as ("vehiculo" | "categoria")[],
    assignees: [] as OrderAssignee[],
    assignableCount: 2,
    canAssign: true,
    canManageTechnicians: true,
  };
  const ASSIGN_TEXT = "Para pasarla a En diagnóstico, asigná un técnico.";

  it("open without assignee offers 'assign' when somebody is assignable", () => {
    expect(statusBarHint(base)).toEqual({ text: ASSIGN_TEXT, action: "assign" });
  });
  it("open without assignee and nobody assignable offers 'technicians' to a manager", () => {
    expect(statusBarHint({ ...base, assignableCount: 0 })).toEqual({ text: ASSIGN_TEXT, action: "technicians" });
  });
  it("open, nobody assignable, no technicians.manage: text only", () => {
    expect(statusBarHint({ ...base, assignableCount: 0, canManageTechnicians: false })).toEqual({ text: ASSIGN_TEXT });
  });
  it("open with an assignee shows nothing", () => {
    expect(statusBarHint({ ...base, assignees: [assignee("Luis")] })).toBeNull();
  });
  it("shows nothing to a viewer who cannot assign", () => {
    for (const status of orderStatusEnum.enumValues) {
      expect(statusBarHint({ ...base, status, canAssign: false, missing: ["vehiculo"], assignees: [assignee("A")] })).toBeNull();
    }
  });

  const progress = { ...base, status: "in_progress" as OrderStatus };
  const FALTAN = "Pasa a Lista para revisión cuando todos los técnicos marcan «Mi parte lista». Faltan: ";
  it("in_progress lists the active unmarked technicians, in order", () => {
    const assignees = [assignee("Luis Ríos"), assignee("Marta", { parteLista: true }), assignee("Ana Gómez")];
    expect(statusBarHint({ ...progress, assignees })).toEqual({ text: `${FALTAN}Luis Ríos, Ana Gómez.` });
  });
  it("in_progress excludes a deactivated technician", () => {
    const assignees = [assignee("Luis Ríos"), assignee("Ana Gómez", { active: false })];
    expect(statusBarHint({ ...progress, assignees })).toEqual({ text: `${FALTAN}Luis Ríos.` });
  });
  it("in_progress with nobody unmarked and active shows nothing", () => {
    const assignees = [assignee("Luis", { parteLista: true }), assignee("Ana", { active: false })];
    expect(statusBarHint({ ...progress, assignees })).toBeNull();
    expect(statusBarHint(progress)).toBeNull();
  });
  it("'Faltan' appears only on in_progress", () => {
    for (const status of orderStatusEnum.enumValues.filter((s) => s !== "in_progress")) {
      const hint = statusBarHint({ ...base, status, assignees: [assignee("Luis")] });
      expect(hint?.text ?? "", status).not.toContain("Faltan");
    }
  });

  const booked = { ...base, status: "booked" as OrderStatus };
  const EDIT_TEXT = "Completá el vehículo y la categoría antes de recibir la orden.";
  it("booked missing the vehicle or the category offers 'edit'", () => {
    expect(statusBarHint({ ...booked, missing: ["vehiculo"] })).toEqual({ text: EDIT_TEXT, action: "edit" });
    expect(statusBarHint({ ...booked, missing: ["categoria"] })).toEqual({ text: EDIT_TEXT, action: "edit" });
    expect(statusBarHint({ ...booked, missing: ["vehiculo", "categoria"] })).toEqual({ text: EDIT_TEXT, action: "edit" });
  });
  it("booked complete shows nothing", () => {
    expect(statusBarHint(booked)).toBeNull();
  });
  it("closed and other statuses show nothing", () => {
    for (const status of ["diagnosing", "on_hold", "ready_for_review", "done", "cancelled"] as const) {
      expect(statusBarHint({ ...base, status, missing: ["vehiculo"] }), status).toBeNull();
    }
  });
});

describe("workLinesHint", () => {
  const base = {
    status: "open" as OrderStatus,
    own: undefined as OrderAssignee | undefined,
    assigneeCount: 0,
    assignableCount: 1,
    canManageAll: true,
    canManageTechnicians: true,
  };
  const me = (over: Partial<OrderAssignee> = {}) => assignee("Yo", over);

  it("open without assignee, jefe: assign button", () => {
    expect(workLinesHint(base)).toEqual({ text: "Asigná un técnico para poder cargar líneas.", action: "assign" });
  });
  it("open without assignee, nobody assignable: 'Ir a Técnicos' only with technicians.manage", () => {
    expect(workLinesHint({ ...base, assignableCount: 0 })).toEqual({
      text: "Asigná un técnico para poder cargar líneas.",
      action: "technicians",
    });
    expect(workLinesHint({ ...base, assignableCount: 0, canManageTechnicians: false })).toEqual({
      text: "Asigná un técnico para poder cargar líneas.",
    });
  });
  it("open with an assignee, or viewed by a técnico: nothing", () => {
    expect(workLinesHint({ ...base, assigneeCount: 1 })).toBeNull();
    expect(workLinesHint({ ...base, canManageAll: false, own: me() })).toBeNull();
  });
  it("booked: jefe vs técnico", () => {
    expect(workLinesHint({ ...base, status: "booked", assigneeCount: 1 })).toEqual({
      text: "Recibí la orden para cargar líneas.",
    });
    expect(workLinesHint({ ...base, status: "booked", assigneeCount: 1, canManageAll: false, own: me() })).toEqual({
      text: "El jefe de taller tiene que recibir la orden para cargar líneas.",
    });
  });
  it("on_hold: jefe vs técnico", () => {
    expect(workLinesHint({ ...base, status: "on_hold" })).toEqual({
      text: "La orden está en espera; reanudala para cargar líneas.",
    });
    expect(workLinesHint({ ...base, status: "on_hold", canManageAll: false, own: me() })).toEqual({
      text: "La orden está en espera; el jefe de taller tiene que reanudarla.",
    });
  });
  it("diagnosing: informational for a técnico only", () => {
    expect(workLinesHint({ ...base, status: "diagnosing", canManageAll: false, own: me() })).toEqual({
      text: "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso.",
    });
    expect(workLinesHint({ ...base, status: "diagnosing" })).toBeNull();
  });
  it("marked técnico on in_progress and ready_for_review: 'Desmarcá…', never 'solo el jefe…'", () => {
    for (const status of ["in_progress", "ready_for_review"] as const) {
      const hint = workLinesHint({ ...base, status, canManageAll: false, own: me({ parteLista: true }) });
      expect(hint, status).toEqual({ text: "Desmarcá tu parte lista antes de cambiar líneas de trabajo." });
    }
  });
  it("a jefe who is also assigned and marked still sees no técnico hint", () => {
    for (const status of ["diagnosing", "in_progress", "ready_for_review"] as const) {
      expect(workLinesHint({ ...base, status, own: me({ parteLista: true }) }), status).toBeNull();
    }
    expect(workLinesHint({ ...base, status: "diagnosing", own: me() })).toBeNull();
  });
  it("a técnico with a marked part on diagnosing gets no 'Vas a poder marcar' hint", () => {
    expect(workLinesHint({ ...base, status: "diagnosing", canManageAll: false, own: me({ parteLista: true }) })).toBeNull();
  });
  it("a técnico not assigned to the order sees no booked/on_hold hint", () => {
    for (const status of ["booked", "on_hold"] as const) {
      expect(workLinesHint({ ...base, status, canManageAll: false }), status).toBeNull();
    }
  });
  it("nothing when the viewer can write", () => {
    expect(workLinesHint({ ...base, status: "in_progress", canManageAll: false, own: me() })).toBeNull();
    expect(workLinesHint({ ...base, status: "in_progress" })).toBeNull();
    expect(workLinesHint({ ...base, status: "ready_for_review" })).toBeNull();
  });
  it("nothing on a closed order", () => {
    for (const status of ["done", "cancelled"] as const) {
      expect(workLinesHint({ ...base, status }), status).toBeNull();
      expect(workLinesHint({ ...base, status, canManageAll: false, own: me({ parteLista: true }) }), status).toBeNull();
    }
  });
});
