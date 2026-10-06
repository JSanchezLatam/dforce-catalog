import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select, SelectTrigger, SelectValue } from "./select";

/** Audit #5: the trigger rises with the Input beside it on touch. */
describe("SelectTrigger — touch floor (audit #5)", () => {
  it.each(["default", "sm"] as const)("%s size rises to 44px on a coarse pointer", (size) => {
    render(
      <Select>
        <SelectTrigger size={size} aria-label="Estado">
          <SelectValue />
        </SelectTrigger>
      </Select>,
    );

    expect(screen.getByRole("combobox")).toHaveClass(`pointer-coarse:data-[size=${size}]:h-11`);
  });
});
