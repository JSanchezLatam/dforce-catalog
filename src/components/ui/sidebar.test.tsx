import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
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
