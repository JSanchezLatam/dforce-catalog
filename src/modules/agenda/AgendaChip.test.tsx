import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgendaChip } from "./AgendaChip";
import { makeItem } from "./items.fixture";

describe("AgendaChip", () => {
  it("Narrow columns: the link can shrink and name, phone and vehicle wrap instead of clipping", () => {
    render(<AgendaChip item={makeItem({ customerName: "Nombre muy largo", customerPhone: "+50761234567", vehicleLabel: "ABC1234" })} />);
    expect(screen.getByRole("link").className).toContain("min-w-0");
    for (const text of ["Nombre muy largo", "+50761234567", "ABC1234"]) {
      expect(screen.getByText(text).className).toContain("[overflow-wrap:anywhere]");
    }
  });
});
