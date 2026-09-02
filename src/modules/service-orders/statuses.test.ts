/**
 * Mirrors `categories.test.ts`: the point of the map is that a new enum member
 * cannot ship without a label, so the test iterates the ENUM rather than the
 * map's own keys.
 */
import { describe, expect, it } from "vitest";

import { orderStatusEnum } from "@/shared/db/schema";
import { ORDER_STATUS_LABEL } from "./statuses";

describe("ORDER_STATUS_LABEL", () => {
  it("covers every orderStatusEnum value with a non-empty Spanish label", () => {
    for (const value of orderStatusEnum.enumValues) {
      expect(ORDER_STATUS_LABEL[value]).toEqual(expect.any(String));
      expect(ORDER_STATUS_LABEL[value].length).toBeGreaterThan(0);
    }
  });

  it("labels in_progress distinctly from done, the pair a technician reads fastest", () => {
    expect(ORDER_STATUS_LABEL.in_progress).toBe("En progreso");
    expect(ORDER_STATUS_LABEL.done).toBe("Completada");
  });
});
