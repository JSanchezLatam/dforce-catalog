import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

/**
 * Audit #20: the unchecked border was `border-input` (hsl(240 5.9% 90%)), which
 * is a divider tone: about 1.2:1 on the white light-theme ground, so the table
 * checkbox was nearly invisible (WCAG 1.4.11 asks 3:1 for the edge of a control).
 * `border-muted-foreground` is the theme-aware token already used for secondary
 * ink and sits at the mockup's zinc-500 level in light. jsdom computes no colour:
 * this pins the class, the ratio is measured in the browser.
 */
describe("Checkbox — unchecked border contrast (audit #20)", () => {
  it("uses `border-muted-foreground`, not the pale `border-input`", () => {
    render(<Checkbox aria-label="Seleccionar" />);
    const box = screen.getByRole("checkbox");

    expect(box).toHaveClass("border-muted-foreground");
    expect(box).not.toHaveClass("border-input");
  });

  it("keeps the checked state on the primary border", () => {
    render(<Checkbox aria-label="Seleccionar" defaultChecked />);

    expect(screen.getByRole("checkbox")).toHaveClass("data-checked:border-primary");
  });
});

/**
 * Audit #9: the box is 16px and its invisible hit area was 40x32. `-inset-3.5`
 * (14px each side) makes it 44x44.
 */
describe("Checkbox — touch floor (audit #9)", () => {
  it("extends the hit area 14px on every side (16 + 28 = 44)", () => {
    render(<Checkbox aria-label="Seleccionar" />);

    expect(screen.getByRole("checkbox")).toHaveClass("after:-inset-3.5");
  });
});
