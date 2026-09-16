import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

/**
 * H1 — the "0 en stock" chip on `/inventory/[id]` was reported as illegible in
 * dark mode. Measured, not eyeballed, with the WCAG 2.1 relative-luminance
 * formula against the palette in `globals.css`:
 *
 * | theme | text | ground (over `--card`) | ratio |
 * |---|---|---|---|
 * | light | `--destructive` hsl(0 84.2% 60.2%) | `bg-destructive/10` #fdecec | **3.30:1** |
 * | dark  | `--destructive` hsl(0 62.8% 30.6%) | `bg-destructive/20` #241113 | **1.80:1** |
 *
 * AA for normal text is 4.5:1, so BOTH themes failed — dark just failed loudly
 * enough to get reported. The cause is that dark's `--destructive` is a
 * near-maroon meant to be a BACKGROUND (it is what `StatusBadge`'s `failed`
 * paints behind near-white text, 9.59:1); this variant uses it as a FOREGROUND.
 *
 * The ground is kept — a tinted chip is the destructive badge's whole identity,
 * and every alternative that keeps `--destructive` as the text colour or as a
 * solid ground still fails light (white on hsl(0 84.2% 60.2%) is 3.60:1).
 * Swapping only the text colour clears AA in both:
 *
 * | theme | text | ratio |
 * |---|---|---|
 * | light | `text-red-700` #c10007 | **5.64:1** |
 * | dark  | `text-red-400` #ff6467 | **6.24:1** |
 *
 * These assertions pin the classes. They do NOT prove legibility: jsdom
 * computes no colour and `getBoundingClientRect` returns zeros, so the ratios
 * above come from the arithmetic, not from this file.
 */
describe("Badge — destructive variant contrast (H1)", () => {
  it("does not paint its label with `--destructive`, which fails AA in both themes", () => {
    render(<Badge variant="destructive">0 en stock</Badge>);

    expect(screen.getByText("0 en stock")).not.toHaveClass("text-destructive");
  });

  it("uses a red that clears 4.5:1 on the tinted ground in each theme", () => {
    render(<Badge variant="destructive">0 en stock</Badge>);
    const badge = screen.getByText("0 en stock");

    expect(badge).toHaveClass("text-red-700"); // 5.64:1 on #fdecec
    expect(badge).toHaveClass("dark:text-red-400"); // 6.24:1 on #241113
  });

  it("keeps the tinted ground, so the chip still reads as destructive", () => {
    render(<Badge variant="destructive">0 en stock</Badge>);
    const badge = screen.getByText("0 en stock");

    expect(badge).toHaveClass("bg-destructive/10");
    expect(badge).toHaveClass("dark:bg-destructive/20");
  });
});
