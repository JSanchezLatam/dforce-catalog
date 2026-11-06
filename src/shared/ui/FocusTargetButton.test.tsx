/**
 * order-blocked-action-hints WU4 (D3). jsdom has no layout and no
 * `scrollIntoView`, so the SCROLL is stubbed here and verified in a real
 * browser; what this file pins is the focus call and its guards.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FocusTargetButton } from "./FocusTargetButton";

afterEach(() => {
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function renderWithTarget() {
  return render(
    <>
      <FocusTargetButton targetId="assign-tecnico">Asignar técnico</FocusTargetButton>
      <select id="assign-tecnico" aria-label="destino" />
    </>,
  );
}

describe("FocusTargetButton", () => {
  it("focuses the element it points at when clicked", async () => {
    renderWithTarget();
    await userEvent.setup().click(screen.getByRole("button", { name: "Asignar técnico" }));

    expect(screen.getByLabelText("destino")).toHaveFocus();
  });

  it("scrolls the target to the centre before focusing without a second scroll", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    renderWithTarget();
    await userEvent.setup().click(screen.getByRole("button", { name: "Asignar técnico" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("does not throw where scrollIntoView does not exist (jsdom)", async () => {
    renderWithTarget();
    expect("scrollIntoView" in HTMLElement.prototype).toBe(false);
    await userEvent.setup().click(screen.getByRole("button", { name: "Asignar técnico" }));

    expect(screen.getByLabelText("destino")).toHaveFocus();
  });

  it("does nothing when the target is not on the page", async () => {
    // React reports a throwing handler on window "error" instead of failing the click.
    const onError = vi.fn((e: ErrorEvent) => e.preventDefault());
    window.addEventListener("error", onError);
    render(<FocusTargetButton targetId="nope">Asignar técnico</FocusTargetButton>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Asignar técnico" }));
    window.removeEventListener("error", onError);

    expect(onError).not.toHaveBeenCalled();

    // Focus stays where the click put it: on the button, with no throw.
    expect(screen.getByRole("button", { name: "Asignar técnico" })).toHaveFocus();
  });

  it("keeps the 44x44 floor on a non-default-size action", () => {
    renderWithTarget();

    expect(screen.getByRole("button", { name: "Asignar técnico" })).toHaveClass("min-h-11", "min-w-11");
  });
});
