import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

/** Audit #5: fields rise with the buttons beside them on touch (filter strips). */
describe("Input — touch floor (audit #5)", () => {
  it("rises to 44px on a coarse pointer and stays h-8 on a fine one", () => {
    render(<Input aria-label="Buscar" />);

    expect(screen.getByRole("textbox")).toHaveClass("h-8", "pointer-coarse:h-11");
  });
});
