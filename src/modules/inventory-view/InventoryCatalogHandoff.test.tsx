import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MAX_TOTAL_PRODUCTS } from "@/modules/catalog-builder/selection";

import { InventoryCatalogHandoff } from "./InventoryCatalogHandoff";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/shared/ui/selection/SelectionProvider", () => ({
  useSelection: () => ({ selected: new Set(Array.from({ length: MAX_TOTAL_PRODUCTS + 1 }, (_, i) => `p${i}`)) }),
}));

/**
 * Audit #7 (same root): the over-cap refusal was `text-destructive` as text.
 * It reuses `FIELD_ERROR`, the shared red pair. The mocked selection is the only
 * way into the refusal branch without a real provider; the colour is the subject.
 */
describe("InventoryCatalogHandoff — refusal colour (audit #7)", () => {
  it("renders the over-cap refusal with the theme-paired red", async () => {
    render(<InventoryCatalogHandoff />);
    await userEvent.click(screen.getByRole("button", { name: "Enviar al generador" }));

    const refusal = screen.getByRole("alert");
    expect(refusal).toHaveClass("text-red-700", "dark:text-red-400");
    expect(refusal).not.toHaveClass("text-destructive");
  });
});
