import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InventoryStatsHeader } from "./InventoryStatsHeader";

/**
 * Audit #19: the avatar was `bg-primary text-white`. Dark's `--primary` is
 * near-white, so the initial was white on white. `text-primary-foreground` is
 * the token that flips with it. jsdom computes no colour: class only.
 */
describe("InventoryStatsHeader — avatar contrast (audit #19)", () => {
  it("pairs the avatar with `text-primary-foreground`, never fixed white", () => {
    const { container } = render(<InventoryStatsHeader user={{ id: "u1", role: "administrador" }} total={3} />);
    const avatar = container.querySelector("[aria-hidden='true'].rounded-full");

    expect(avatar).not.toBeNull();
    expect(avatar).toHaveClass("bg-primary", "text-primary-foreground");
    expect(avatar).not.toHaveClass("text-white");
    expect(avatar).toHaveTextContent("A");
  });

  it("shows the initial of the role label for another role", () => {
    const { container } = render(<InventoryStatsHeader user={{ id: "u2", role: "tecnico" }} total={0} />);
    const avatar = container.querySelector("[aria-hidden='true'].rounded-full");

    expect(avatar).toHaveClass("text-primary-foreground");
    expect(avatar).toHaveTextContent("T");
  });
});
