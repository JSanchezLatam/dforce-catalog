import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/modules/auth/roles";
import { orderStatusEnum } from "@/shared/db/schema";
import { MATRIX } from "@/modules/auth/policy";
import { canChangeOrderPhotos, canEditOrderFields, isClosedStatus, orderEditMode } from "./edit-policy";
import type { OrderStatus } from "./transitions";

/**
 * D11 — all fifteen `(role, status)` combinations, spelled out one per row so a
 * flipped cell in `edit-policy.ts` fails by a name that says which cell moved.
 * A parametrised expectation derived from the same shape as the source would
 * only re-state the implementation.
 */
const TRUTH_TABLE: ReadonlyArray<[Role, OrderStatus, boolean]> = [
  ["administrador", "open", true],
  ["administrador", "in_progress", true],
  ["administrador", "ready_for_review", true],
  ["administrador", "done", false],
  ["administrador", "cancelled", false],
  ["jefe_taller", "open", true],
  ["jefe_taller", "in_progress", true],
  ["jefe_taller", "ready_for_review", true],
  ["jefe_taller", "done", false],
  ["jefe_taller", "cancelled", false],
  ["tecnico", "open", false],
  ["tecnico", "in_progress", true],
  ["tecnico", "ready_for_review", false],
  ["tecnico", "done", false],
  ["tecnico", "cancelled", false],
];

describe("canEditOrderFields (D11)", () => {
  it.each(TRUTH_TABLE)("%s on a %s order -> %s", (role, status, expected) => {
    expect(canEditOrderFields(role, status)).toBe(expected);
  });

  /**
   * The table above is only exhaustive for as long as the two enums it was
   * written against are. A new `Role` or a new `orden_servicio.status` would
   * otherwise slip in with no row and no failure — and the predicate's `?? false`
   * fallback would silently refuse it everywhere instead of anyone noticing.
   */
  it("covers every role and every status the schema actually defines", () => {
    expect(TRUTH_TABLE.length).toBe(ROLES.length * orderStatusEnum.enumValues.length);
    for (const role of ROLES) {
      for (const status of orderStatusEnum.enumValues) {
        expect(TRUTH_TABLE.some(([r, s]) => r === role && s === status)).toBe(true);
      }
    }
  });
});

/**
 * Photos are a separate gate from `canEditOrderFields`: a técnico must be able
 * to photograph an `open` order (D11 forbids them its field edits), so this
 * takes no role. One row per status so a flipped cell fails by name.
 */
describe("canChangeOrderPhotos", () => {
  it.each<[OrderStatus, boolean]>([
    ["open", true],
    ["in_progress", true],
    ["ready_for_review", true],
    ["done", false],
    ["cancelled", false],
  ])("a %s order -> %s", (status, expected) => {
    expect(canChangeOrderPhotos(status)).toBe(expected);
  });

  it("covers every status the schema defines", () => {
    for (const status of orderStatusEnum.enumValues) {
      expect(typeof canChangeOrderPhotos(status)).toBe("boolean");
    }
  });
});

describe("isClosedStatus", () => {
  it.each<[OrderStatus, boolean]>([
    ["open", false],
    ["in_progress", false],
    ["ready_for_review", false],
    ["done", true],
    ["cancelled", true],
  ])("a %s order -> %s", (status, expected) => {
    expect(isClosedStatus(status)).toBe(expected);
  });

  it("covers every status the schema defines", () => {
    for (const status of orderStatusEnum.enumValues) {
      expect(typeof isClosedStatus(status)).toBe("boolean");
    }
  });
});

/**
 * What the detail page offers, one row per `(role, status)` cell. A closed order
 * is never plainly editable: an administrador gets "correction" (password
 * required), anybody else is "refused".
 */
describe("orderEditMode", () => {
  it.each<[Role, OrderStatus, "edit" | "correction" | "refused"]>([
    ["administrador", "open", "edit"],
    ["administrador", "in_progress", "edit"],
    ["administrador", "ready_for_review", "edit"],
    ["administrador", "done", "correction"],
    ["administrador", "cancelled", "correction"],
    ["jefe_taller", "open", "edit"],
    ["jefe_taller", "ready_for_review", "edit"],
    ["jefe_taller", "done", "refused"],
    ["jefe_taller", "cancelled", "refused"],
    ["tecnico", "open", "refused"],
    ["tecnico", "in_progress", "edit"],
    ["tecnico", "ready_for_review", "refused"],
    ["tecnico", "done", "refused"],
    ["tecnico", "cancelled", "refused"],
  ])("%s on a %s order -> %s", (role, status, expected) => {
    expect(orderEditMode(role, status)).toBe(expected);
  });

  it("refuses an unrecognised role, as canEditOrderFields does", () => {
    expect(orderEditMode("intruso" as Role, "done")).toBe("refused");
  });

  /** The role literal in `edit-policy.ts` must not drift from the policy matrix. */
  it("offers correction to exactly the roles holding service-orders.correct", () => {
    for (const role of ROLES) {
      expect(orderEditMode(role, "done") === "correction").toBe(MATRIX[role]["service-orders.correct"]);
    }
  });
});
