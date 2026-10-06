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

  /**
   * Audit #7: `text-destructive` as text fails AA in both themes (3.30:1 light,
   * 1.80:1 dark, measured in `badge.test.tsx`, same `bg-destructive/10` ground).
   * `text-red-700` / `dark:text-red-400` are the pair measured there.
   */
  it("destructive text is a theme pair, not `--destructive`", () => {
    render(<Alert variant="destructive">No se pudo guardar</Alert>);
    const alert = screen.getByText("No se pudo guardar");

    expect(alert).not.toHaveClass("text-destructive");
    expect(alert).toHaveClass("text-red-700", "dark:text-red-400");
  });

  it("default variant carries no red", () => {
    render(<Alert>Aviso</Alert>);

    expect(screen.getByText("Aviso").className).not.toContain("red-");
  });
});
