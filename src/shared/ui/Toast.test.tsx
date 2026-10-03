import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Toast } from "./Toast";

describe("Toast", () => {
  it("names its dismiss button in Spanish", () => {
    render(<Toast toast={{ type: "success", message: "1 cliente desactivado" }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});
