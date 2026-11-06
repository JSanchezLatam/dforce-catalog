import { describe, expect, it } from "vitest";

import { STATUS_HUE } from "@/modules/board/primitives";
import { ORDER_HUE } from "./status-hue";

describe("ORDER_HUE", () => {
  it("holds the seven non-cancelled statuses with the approved board numbers", () => {
    expect(ORDER_HUE).toEqual({
      booked: { h: 188, s: "70%" },
      open: { h: 221, s: "70%" },
      diagnosing: { h: 262, s: "60%" },
      in_progress: { h: 290, s: "50%" },
      on_hold: { h: 220, s: "14%" },
      ready_for_review: { h: 168, s: "60%" },
      done: { h: 142, s: "55%" },
    });
  });

  it("is the source of the board's STATUS_HUE h and s, which only adds the icon", () => {
    for (const [status, { h, s }] of Object.entries(ORDER_HUE)) {
      const board = STATUS_HUE[status as keyof typeof STATUS_HUE];
      expect({ h: board.h, s: board.s }).toEqual({ h, s });
      expect(board.icon).toBeDefined();
    }
  });
});
