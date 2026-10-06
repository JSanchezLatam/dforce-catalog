import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmGenerateDialog } from "./ConfirmGenerateDialog";

function renderDialog(catalogCount: number) {
  return render(
    <ConfirmGenerateDialog
      open
      onOpenChange={vi.fn()}
      categories={[]}
      title="Lista de precios"
      productCount={10}
      catalogCount={catalogCount}
      isSubmitting={false}
      error={null}
      onConfirm={vi.fn()}
    />
  );
}

/**
 * Audit #22: the warning box was `bg-amber-50 text-amber-800` with no dark
 * counterpart, so in dark it was a pale slab on a dark dialog. jsdom computes no
 * colour: the pair is pinned by class, the ratio is measured in the browser.
 */
describe("ConfirmGenerateDialog — warning box is theme-paired (audit #22)", () => {
  it("carries a dark: counterpart for ground, border and text", () => {
    renderDialog(2);
    const box = screen.getByText(/Ya tienes 2 catálogos guardados/).closest("div");

    expect(box).toHaveClass("border-amber-200", "bg-amber-50", "text-amber-800");
    expect(box).toHaveClass("dark:border-amber-400/30", "dark:bg-amber-950", "dark:text-amber-300");
  });

  it("does not render the box below the two-catalog threshold", () => {
    renderDialog(1);

    expect(screen.queryByText(/catálogos guardados/)).not.toBeInTheDocument();
  });
});
