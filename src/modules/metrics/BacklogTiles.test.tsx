import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BacklogTiles } from "./BacklogTiles";

describe("BacklogTiles", () => {
  it("shows each open status as a labelled plain number, zeros included", () => {
    render(<BacklogTiles counts={{ open: 7, in_progress: 0, ready_for_review: 2 }} />);

    expect(screen.getByText("Abiertas").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("En progreso").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("Lista para revisión").nextElementSibling).toHaveTextContent("2");
  });
});
