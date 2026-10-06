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

/**
 * `text-destructive-foreground` is not a registered utility in this theme, so
 * the error toast emitted no colour class at all: its ink was whatever it
 * inherited, on `bg-destructive` (a near-maroon in dark). It takes the same
 * pale-tint recipe as success, in red, measured in the browser (jsdom computes
 * no colour).
 */
describe("Toast — error is theme-paired (mobile-responsive-pass 9.x)", () => {
  it("uses a red pair with a border, like success", () => {
    render(<Toast toast={{ type: "error", message: "No se pudo guardar" }} onDismiss={vi.fn()} />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveTextContent("No se pudo guardar");
    expect(toast).toHaveClass("border", "border-red-300", "bg-red-50", "text-red-800");
    expect(toast).toHaveClass("dark:border-red-400/30", "dark:bg-red-950", "dark:text-red-300");
  });

  it("no longer names the unregistered foreground or the solid destructive fill", () => {
    render(<Toast toast={{ type: "error", message: "No se pudo guardar" }} onDismiss={vi.fn()} />);
    const toast = screen.getByRole("status");

    expect(toast).not.toHaveClass("text-destructive-foreground");
    expect(toast).not.toHaveClass("bg-destructive");
  });
});
