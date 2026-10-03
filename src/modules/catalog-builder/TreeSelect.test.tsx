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
