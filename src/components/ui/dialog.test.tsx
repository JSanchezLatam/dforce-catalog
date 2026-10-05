import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";

/**
 * Audit #5: the close X was 28px. On touch it is 44px, which would sit over the
 * end of a long title, so the title reserves room beside it (X: 12px inset +
 * 44px = 56px from the edge; content padding 24px + `pr-10` 40px = 64px).
 */
describe("Dialog — touch floor (audit #5)", () => {
  it("close X is 44x44 on a coarse pointer and the title keeps clear of it", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar definitivamente la orden</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    );
    expect(screen.getByText("Eliminar definitivamente la orden")).toHaveClass(
      "pointer-coarse:pr-10",
    );
  });
});
