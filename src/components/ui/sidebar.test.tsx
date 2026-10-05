import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  Sidebar,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
} from "./sidebar";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

/** Audit #10: nav rows were 32/28px; they rise to 44px on touch only. */
describe("Sidebar — touch floor (audit #10)", () => {
  it("menu buttons rise to 44px on a coarse pointer, both sizes", () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton>Inventario</SidebarMenuButton>
        <SidebarMenuButton size="sm">Pequeño</SidebarMenuButton>
      </SidebarProvider>,
    );

    for (const name of ["Inventario", "Pequeño"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("pointer-coarse:h-11");
    }
  });

  it("sub-menu buttons rise to 44px on a coarse pointer", () => {
    render(
      <SidebarProvider>
        <SidebarMenuSubButton href="/x">Sub</SidebarMenuSubButton>
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: "Sub" })).toHaveClass("pointer-coarse:h-11");
  });

  it("group labels rise to 44px on a coarse pointer", () => {
    render(
      <SidebarProvider>
        <SidebarGroupLabel>Taller</SidebarGroupLabel>
      </SidebarProvider>,
    );

    expect(screen.getByText("Taller")).toHaveClass("pointer-coarse:h-11");
  });
});

/** Audit #17a: the desktop sidebar and the off-canvas sheet swap at `lg` (1024), not `md`. */
describe("Sidebar — off-canvas breakpoint (audit #17a)", () => {
  it("the desktop sidebar shows from lg, not md", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <p>nav</p>
        </Sidebar>
      </SidebarProvider>,
    );

    const wrapper = container.querySelector('[data-slot="sidebar"]');
    expect(wrapper).toHaveClass("lg:block");
    expect(wrapper).not.toHaveClass("md:block");

    const panel = container.querySelector('[data-slot="sidebar-container"]');
    expect(panel).toHaveClass("lg:flex");
    expect(panel).not.toHaveClass("md:flex");
  });

  it("the inset variant spacing applies from lg", () => {
    render(
      <SidebarProvider>
        <SidebarInset>x</SidebarInset>
      </SidebarProvider>,
    );

    const cls = screen.getByText("x").className;
    expect(cls).toContain("lg:peer-data-[variant=inset]:m-2");
    expect(cls).not.toContain("md:");
  });

  it("the touch hit-area expansion and hover-reveal follow the same breakpoint", () => {
    render(
      <SidebarProvider>
        <SidebarGroupAction aria-label="g" />
        <SidebarMenuAction aria-label="m" />
        <SidebarMenuAction aria-label="h" showOnHover />
      </SidebarProvider>,
    );

    for (const name of ["g", "m"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls).toContain("lg:after:hidden");
      expect(cls).not.toContain("md:");
    }
    expect(screen.getByRole("button", { name: "h" })).toHaveClass("lg:opacity-0");
    expect(screen.getByRole("button", { name: "h" }).className).not.toContain("md:");
  });

  it("the rail stays desktop-only: it lives inside the desktop wrapper and never gains an lg: show", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    const rail = container.querySelector('[data-slot="sidebar-rail"]');
    expect(container.querySelector('[data-slot="sidebar"]')).toContainElement(rail as HTMLElement);
    expect(rail).toHaveClass("hidden");
  });
});
