import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

/**
 * Audit #7: `destructive` used `--destructive` as TEXT. Dark's token is a
 * near-maroon built to be a background (1.80:1 as a foreground, see
 * `badge.test.tsx`); light's is 3.30:1. The target is the approved mockup's
 * "Eliminar definitivamente" button: red-700 on a red-500/10 tint in light,
 * red-300 on red-500/20 in dark. jsdom computes no colour: classes only.
 */
describe("Button — destructive variant contrast (audit #7)", () => {
  it("does not paint its label with `--destructive`", () => {
    render(<Button variant="destructive">Eliminar definitivamente</Button>);

    expect(screen.getByRole("button")).not.toHaveClass("text-destructive");
  });

  it("uses the mockup's light and dark text and ground", () => {
    render(<Button variant="destructive">Eliminar definitivamente</Button>);
    const button = screen.getByRole("button");

    expect(button).toHaveClass("bg-red-500/10", "text-red-700");
    expect(button).toHaveClass("dark:bg-red-500/20", "dark:text-red-300");
  });

  it("leaves the other variants alone", () => {
    render(<Button variant="outline">Cancelar</Button>);

    expect(screen.getByRole("button").className).not.toContain("red-");
  });
});
