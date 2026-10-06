/**
 * Audit-final N5: the footer was `text-muted-foreground` on the page's own
 * `bg-muted` (4.40:1 in light, under 4.5) and its second line stacked
 * `opacity-75` on top (about 2.8:1). The light colour is now `text-foreground/70`
 * (7.4:1); dark keeps the muted token with no extra opacity (5.8:1 measured; the
 * old `dark:opacity-75` made it 3.93:1). jsdom computes no colour,
 * so this reads the class pair.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/LoginForm", () => ({ LoginForm: () => <form aria-label="login" /> }));
vi.mock("@/modules/auth/LoginThemeToggle", () => ({ LoginThemeToggle: () => <button type="button">tema</button> }));

import LoginPage from "./page";

describe("LoginPage — footer contrast in light (audit-final N5)", () => {
  it.each(["Desarrollado por Jorge Sanchez", "Versión 1.0 · Septiembre 2026"])(
    "%s uses a darker light-theme text and keeps the muted token in dark",
    (text) => {
      render(<LoginPage />);

      const line = screen.getByText(text);
      expect(line.parentElement).toHaveClass("text-foreground/70", "dark:text-muted-foreground");
      expect(line.parentElement).not.toHaveClass("text-muted-foreground");
      // Never dimmed a second time in either theme: measured at the LAN IP, the
      // dark `opacity-75` on the muted token read 3.93:1, under 4.5.
      expect(line).not.toHaveClass("opacity-75");
      expect(line.className).not.toMatch(/opacity-/);
    },
  );
});
