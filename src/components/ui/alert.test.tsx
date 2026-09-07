import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert } from "./alert";

describe("Alert", () => {
  /**
   * The deliberate part of this component's contract, per its own docblock:
   * it declares NO role of its own, because every caller already knows whether
   * its message is an `alert` (a failure being announced) or a `status` (state
   * that was there on load). Baking one in would silently promote or demote
   * theirs — `customers/[id]/page.tsx` renders it as `status` on purpose.
   */
  it("adds no implicit role, so a caller's status is not promoted to alert", () => {
    render(<Alert>Sin rol propio</Alert>);

    expect(screen.getByText("Sin rol propio")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("passes a caller's role straight through", () => {
    render(<Alert role="status">Cliente desactivado</Alert>);

    expect(screen.getByRole("status")).toHaveTextContent("Cliente desactivado");
  });
});
