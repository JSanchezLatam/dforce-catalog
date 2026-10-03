import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImagePreviewDialog } from "./ImagePreviewDialog";

describe("ImagePreviewDialog", () => {
  it("names its close button in Spanish", async () => {
    render(<ImagePreviewDialog src="https://example.com/p.jpg" alt="Filtro de aceite" onClose={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});
