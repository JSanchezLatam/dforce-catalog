import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("names its dismiss button in Spanish", () => {
    render(<Toast toast={{ type: "success", message: "1 cliente desactivado" }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});

/**
 * Audit #6: the success toast was white on `bg-success` (hsl(142 71% 45%)),
 * which fails 4.5:1 in both themes. Target is the approved mockup's toast:
 * ink on a pale tint with a border in light, light ink on a deep tint in dark.
 * jsdom computes no colour; these pin the classes and the ratios are measured
 * in the browser. `Toast` has no warning type today, so there is no warning map.
 */
describe("Toast — success is theme-paired (audit #6)", () => {
  it("uses the mockup's light and dark classes", () => {
    render(<Toast toast={{ type: "success", message: "Cliente actualizado" }} onDismiss={vi.fn()} />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveClass("border", "border-green-300", "bg-green-50", "text-green-800");
    expect(toast).toHaveClass("dark:border-green-400/30", "dark:bg-green-950", "dark:text-green-300");
  });

  it("no longer paints the solid success fill with white ink", () => {
    render(<Toast toast={{ type: "success", message: "Cliente actualizado" }} onDismiss={vi.fn()} />);
    const toast = screen.getByRole("status");

    expect(toast).not.toHaveClass("bg-success");
    expect(toast).not.toHaveClass("text-success-foreground");
  });
});
