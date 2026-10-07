import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/modules/auth/roles";
import { orderStatusEnum } from "@/shared/db/schema";
import { MATRIX } from "@/modules/auth/policy";
import { canChangeOrderPhotos, canEditOrderFields, isClosedStatus, orderEditMode, workLineMode } from "./edit-policy";
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
 * to photograph an `open` order (D11 forbids them its field edits), so the
 * status decides, with ONE role split: in review only staff (a caller holding
 * `service-orders.assign`) may add. One row per cell so a flipped one fails by name.
 */
describe("canChangeOrderPhotos", () => {
  it.each<[OrderStatus, boolean, boolean]>([
    // status, staff, expected
    ["open", false, true],
    ["open", true, true],
    ["in_progress", false, true],
    ["in_progress", true, true],
    ["ready_for_review", false, false],
    ["ready_for_review", true, true],
    ["done", false, false],
    ["done", true, false],
    ["cancelled", false, false],
    ["cancelled", true, false],
  ])("a %s order, staff %s -> %s", (status, staff, expected) => {
    expect(canChangeOrderPhotos(status, staff)).toBe(expected);
  });

  it("covers every status the schema defines", () => {
    for (const status of orderStatusEnum.enumValues) {
      expect(typeof canChangeOrderPhotos(status, false)).toBe("boolean");
      expect(typeof canChangeOrderPhotos(status, true)).toBe("boolean");
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

/** The status/role half of who writes work lines; the técnico's own-line and un-marked conditions are the card's. */
describe("workLineMode (order-work-lines, who writes lines)", () => {
  it.each<[Role, OrderStatus, "write" | "correction" | "refused"]>([
    ["administrador", "open", "refused"],
    ["administrador", "in_progress", "write"],
    ["administrador", "ready_for_review", "write"],
    ["administrador", "done", "correction"],
    ["administrador", "cancelled", "correction"],
    ["jefe_taller", "open", "refused"],
    ["jefe_taller", "in_progress", "write"],
    ["jefe_taller", "ready_for_review", "write"],
    ["jefe_taller", "done", "refused"],
    ["jefe_taller", "cancelled", "refused"],
    ["tecnico", "open", "refused"],
    ["tecnico", "in_progress", "write"],
    ["tecnico", "ready_for_review", "refused"],
    ["tecnico", "done", "refused"],
    ["tecnico", "cancelled", "refused"],
  ])("%s on a %s order -> %s", (role, status, expected) => {
    expect(workLineMode(role, status)).toBe(expected);
  });

  it("refuses an unrecognised role", () => {
    expect(workLineMode("intruso" as Role, "in_progress")).toBe("refused");
  });
});
