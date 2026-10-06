import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage } from "./breadcrumb";

/**
 * Audit 2.8: the breadcrumb text link measured 52x20 on a touch device, under
 * AGENTS.md's 44x44. The floor sits behind `pointer-coarse:` like the Button's,
 * so a mouse keeps the 20px line it has today. jsdom matches no media query:
 * class strings only, the LAN measurement is the evidence.
 */
describe("BreadcrumbLink — touch floor (mobile-responsive-pass 9.x)", () => {
  function renderCrumb() {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/customers">Clientes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <BreadcrumbPage>Ana Gómez</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
  }

  it("reaches 44px tall on touch, centred, without a desktop height", () => {
    renderCrumb();
    const link = screen.getByRole("link", { name: "Clientes" });

    expect(link).toHaveClass("pointer-coarse:inline-flex", "pointer-coarse:items-center", "pointer-coarse:min-h-11");
    expect(link.className).not.toMatch(/(^|\s)(min-h-11|h-11)(\s|$)/);
  });
});
