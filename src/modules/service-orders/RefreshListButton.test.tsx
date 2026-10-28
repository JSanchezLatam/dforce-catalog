/**
 * PR B — the operator asked for a way to re-read the list without touching the
 * browser's reload. The button is only honest if it says something happened,
 * so the pending label is part of the contract, not decoration.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RefreshListButton } from "./RefreshListButton";

describe("RefreshListButton", () => {
  it("re-reads the server-rendered list through router.refresh()", async () => {
    const user = userEvent.setup();
    render(<RefreshListButton />);

    await user.click(screen.getByRole("button", { name: "Actualizar" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /**
   * AGENTS.md's 44x44 floor — `size="default"` is `h-8` (32px) and this is an
   * action control on a screen used from a tablet. Asserted as the class
   * because jsdom lays nothing out and `getBoundingClientRect` is all zeros,
   * which is exactly why AGENTS.md says a green suite is not evidence of the
   * real height.
   */
  it("carries the 44x44 hit-target floor", () => {
    render(<RefreshListButton />);

    const button = screen.getByRole("button", { name: "Actualizar" });
    expect(button).toHaveClass("min-h-11", "min-w-11");
  });

  it("compact: below md only the icon shows, and the name stays 'Actualizar' for assistive tech", () => {
    render(<RefreshListButton compact />);
    const button = screen.getByRole("button", { name: "Actualizar" });
    expect(screen.getByText("Actualizar").className).toContain("max-md:sr-only");
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
  });

  it("not compact (the service-orders list): the label is never hidden", () => {
    render(<RefreshListButton />);
    expect(screen.getByText("Actualizar").className).not.toContain("sr-only");
  });
});
