import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { LogoutButton } from "./LogoutButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * Audit #7 (same root): "Cerrar sesión" was `text-destructive` as text, which
 * is a near-maroon background tone in dark. jsdom computes no colour: class only.
 */
describe("LogoutButton — colour (audit #7)", () => {
  it("uses the theme-paired red instead of `--destructive`", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Cuenta</DropdownMenuTrigger>
        <DropdownMenuContent>
          <LogoutButton />
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const item = screen.getByRole("menuitem", { name: "Cerrar sesión" });

    expect(item).toHaveClass("text-red-700", "dark:text-red-400");
    expect(item).not.toHaveClass("text-destructive");
  });
});
