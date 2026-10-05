import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TreeSelect } from "./TreeSelect";

describe("TreeSelect — empty search", () => {
  it("says no category matched, in Spanish", async () => {
    const user = userEvent.setup();
    render(
      <TreeSelect
        items={[{ value: "MOTOR", label: "MOTOR", children: [{ value: "MOTOR::FILTROS", label: "FILTROS" }] }]}
        selected={[]}
        onSelectionChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Seleccioná categorías..." }));
    await user.type(screen.getByPlaceholderText("Buscar categorías..."), "zzz");

    expect(screen.getByText("No se encontraron categorías")).toBeInTheDocument();
  });
});

describe("TreeSelect — touch floor (mobile-responsive-pass 9.x)", () => {
  // The trigger was `h-9` (36px) with no touch variant; every other control got
  // the 44px floor behind `pointer-coarse:` in WU2. jsdom matches no media
  // query: class strings only, the 768 touch measurement is the evidence.
  it("grows to 44px on touch and keeps its 36px on a mouse", () => {
    render(<TreeSelect items={[{ value: "A", label: "A" }]} selected={[]} onSelectionChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Seleccioná categorías..." });

    expect(trigger).toHaveClass("h-9", "pointer-coarse:h-11");
  });

  it("keeps the touch floor once categories are chosen and the label changes", () => {
    render(<TreeSelect items={[{ value: "A", label: "A" }]} selected={["A"]} onSelectionChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "1 categoría seleccionada" });

    expect(trigger).toHaveClass("pointer-coarse:h-11");
  });
});
