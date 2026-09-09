import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/modules/auth/roles";
import { orderStatusEnum } from "@/shared/db/schema";
import { canEditOrderFields } from "./edit-policy";
import type { OrderStatus } from "./transitions";

/**
 * D11 — all eight `(role, status)` combinations, spelled out one per row so a
 * flipped cell in `edit-policy.ts` fails by a name that says which cell moved.
 * A parametrised expectation derived from the same shape as the source would
 * only re-state the implementation.
 */
const TRUTH_TABLE: ReadonlyArray<[Role, OrderStatus, boolean]> = [
  ["administrador", "open", true],
  ["administrador", "in_progress", true],
  ["administrador", "done", false],
  ["administrador", "cancelled", false],
  ["tecnico", "open", false],
  ["tecnico", "in_progress", true],
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
