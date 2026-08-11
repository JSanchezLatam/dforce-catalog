/**
 * Component tests for the review-step layout tuner (closes tasks.md 5.2).
 *
 * `ProductLayoutTuner` is presentational: it owns no state, so the bulk
 * frame/restore rule is NOT testable here — that transition lives in
 * `selection.ts`'s `toggleBulkFrame` and is covered in `selection.test.ts`.
 * What this component actually decides is which badge a row shows and which
 * callback a control fires, and that is what these pin.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductLayoutTuner } from "./ProductLayoutTuner";
import type { ProductRef } from "./selection";

const TRANSPARENT: ProductRef = {
  id: "p1",
  name: "Woofer 12",
  categoryL1: "AUDIO",
  categoryL2: null,
  image: "https://example.test/woofer.png",
  imageType: "transparent",
};

const LOW_RES: ProductRef = {
  id: "p2",
  name: "Tweeter",
  categoryL1: "AUDIO",
  categoryL2: null,
  image: null,
  imageType: "low_res",
};

function renderTuner(props: Partial<Parameters<typeof ProductLayoutTuner>[0]> = {}) {
  const onOverride = vi.fn();
  const onBulkFrame = vi.fn();
  render(
    <ProductLayoutTuner
      products={[TRANSPARENT, LOW_RES]}
      overrides={{}}
      bulkFramed={false}
      onOverride={onOverride}
      onBulkFrame={onBulkFrame}
      {...props}
    />,
  );
  return { onOverride, onBulkFrame };
}

function rowFor(name: string) {
  return screen.getByText(name).closest("div.flex.items-center") as HTMLElement;
}

describe("ProductLayoutTuner — which badge a row shows", () => {
  it("shows the classified type when no override is set", () => {
    renderTuner();

    expect(within(rowFor("Woofer 12")).getByText("Transparente")).toBeInTheDocument();
    expect(within(rowFor("Tweeter")).getByText("Baja res.")).toBeInTheDocument();
  });

  // The classified badge must give way, not sit beside the override — showing
  // both would leave the admin guessing which one the PDF will use.
  it("replaces it with an Override badge once one is set", () => {
    renderTuner({ overrides: { p1: "opaque" } });

    const row = rowFor("Woofer 12");
    expect(within(row).getByText(/Override: Opaca/)).toBeInTheDocument();
    expect(within(row).queryByText("Transparente")).not.toBeInTheDocument();
  });

  it("falls back to no badge for an unclassified product", () => {
    renderTuner({ products: [{ ...TRANSPARENT, imageType: null }], overrides: {} });

    const row = rowFor("Woofer 12");
    expect(within(row).queryByText("Transparente")).not.toBeInTheDocument();
    expect(within(row).queryByText(/Override:/)).not.toBeInTheDocument();
  });

  it("renders a placeholder instead of an image when the product has none", () => {
    renderTuner();

    expect(within(rowFor("Tweeter")).getByText("No img")).toBeInTheDocument();
  });
});

describe("ProductLayoutTuner — the bulk control", () => {
  it("offers framing when nothing is bulk-framed", () => {
    renderTuner({ bulkFramed: false });

    expect(screen.getByRole("button", { name: "Enmarcar todos" })).toBeInTheDocument();
  });

  // The label is the only signal that toggling again RESTORES rather than
  // re-applies; if it kept saying "Enmarcar todos" the reset would be invisible.
  it("offers the reset once framing is on", () => {
    renderTuner({ bulkFramed: true });

    expect(screen.getByRole("button", { name: "Reset individual overrides" })).toBeInTheDocument();
  });

  it("reports the toggle to its parent rather than deciding anything itself", async () => {
    const user = userEvent.setup();
    const { onBulkFrame } = renderTuner();

    await user.click(screen.getByRole("button", { name: "Enmarcar todos" }));

    expect(onBulkFrame).toHaveBeenCalledTimes(1);
  });

  it("counts the products under review in the heading", () => {
    renderTuner();

    expect(screen.getByRole("heading", { name: /2 products/ })).toBeInTheDocument();
  });
});

describe("ProductLayoutTuner — the per-product selector", () => {
  it("emits the chosen type for that product", async () => {
    const user = userEvent.setup();
    const { onOverride } = renderTuner();

    const row = rowFor("Woofer 12");
    await user.click(within(row).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Opaca" }));

    expect(onOverride).toHaveBeenCalledWith("p1", "opaque");
  });

  // "Auto" is the sentinel that clears an override; forwarding the literal
  // "__auto__" string would persist a bogus image type into the PDF payload.
  it("emits null — not the sentinel — when Auto is chosen", async () => {
    const user = userEvent.setup();
    const { onOverride } = renderTuner({ overrides: { p1: "opaque" } });

    const row = rowFor("Woofer 12");
    await user.click(within(row).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Auto" }));

    expect(onOverride).toHaveBeenCalledWith("p1", null);
  });
});
