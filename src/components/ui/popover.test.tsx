import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Popover, PopoverContent } from "./popover";

function setup(props: { open: boolean; onOpenChange?: (open: boolean) => void; anchor?: HTMLElement }) {
  return render(
    <>
      <button type="button">Fuera</button>
      <Popover open={props.open} onOpenChange={props.onOpenChange}>
        <PopoverContent anchor={props.anchor} aria-label="Detalle">
          <p>Contenido del detalle</p>
        </PopoverContent>
      </Popover>
    </>,
  );
}

describe("Popover", () => {
  it("renders no portal and no content while closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Contenido del detalle")).not.toBeInTheDocument();
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(document.body.querySelector('[data-slot="popover-portal"]')).toBeNull();
  });

  it("renders its content in a dialog while open", () => {
    setup({ open: true });
    expect(screen.getByRole("dialog", { name: "Detalle" })).toHaveTextContent("Contenido del detalle");
  });

  it("is non-modal: the page behind stays reachable", async () => {
    setup({ open: true });
    expect(screen.getByRole("button", { name: "Fuera" })).toBeInTheDocument();
    // a modal popover adds an inert backdrop layer beside the positioner; this one is the positioner alone
    expect(document.body.querySelector('[data-slot="popover-portal"]')!.children).toHaveLength(1);
  });

  it("is controlled: Escape asks to close and the parent decides", async () => {
    const onOpenChange = vi.fn();
    setup({ open: true, onOpenChange });
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(screen.getByText("Contenido del detalle")).toBeInTheDocument();
  });

  it("asks to close on an outside press", async () => {
    const onOpenChange = vi.fn();
    setup({ open: true, onOpenChange });
    await userEvent.click(screen.getByRole("button", { name: "Fuera" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("does not ask to close on a press inside", async () => {
    const onOpenChange = vi.fn();
    setup({ open: true, onOpenChange });
    await userEvent.click(screen.getByText("Contenido del detalle"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("positions against the given anchor element", async () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const rect = vi.spyOn(anchor, "getBoundingClientRect");
    setup({ open: true, anchor });
    await waitFor(() => expect(rect).toHaveBeenCalled());
    anchor.remove();
  });
});
