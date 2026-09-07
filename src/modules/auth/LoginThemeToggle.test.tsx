/**
 * `next-themes` is mocked because `useTheme` returns `resolvedTheme: undefined`
 * outside a `ThemeProvider`, and this component returns `null` on that — with a
 * real provider there would be nothing to assert.
 *
 * The hydration gate (`useSyncExternalStore` returning `false` on the server
 * snapshot) is deliberately NOT tested: `render()` takes the client snapshot
 * directly rather than a server render plus `hydrateRoot`, so jsdom cannot see
 * the mismatch that gate exists to prevent. See AGENTS.md → Testing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginThemeToggle } from "./LoginThemeToggle";

const theme = vi.hoisted(() => ({ resolved: "light", setTheme: vi.fn() }));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: theme.resolved, setTheme: theme.setTheme }),
}));

describe("LoginThemeToggle", () => {
  beforeEach(() => {
    theme.resolved = "light";
    theme.setTheme.mockClear();
  });

  it("offers dark mode in Spanish while the light theme is active", async () => {
    render(<LoginThemeToggle />);

    expect(screen.getByRole("button", { name: "Activar modo oscuro" })).toBeInTheDocument();
    expect(screen.getByText("Modo oscuro")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Activar modo oscuro" }));

    expect(theme.setTheme).toHaveBeenCalledWith("dark");
  });

  it("offers light mode in Spanish while the dark theme is active", async () => {
    theme.resolved = "dark";

    render(<LoginThemeToggle />);

    expect(screen.getByRole("button", { name: "Activar modo claro" })).toBeInTheDocument();
    expect(screen.getByText("Modo claro")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Activar modo claro" }));

    expect(theme.setTheme).toHaveBeenCalledWith("light");
  });
});
