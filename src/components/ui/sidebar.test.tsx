import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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
  SidebarTrigger,
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

  // Audit-final N4: /70 of the sidebar foreground on the light sidebar is
  // 4.26:1 (min 4.5); /80 is 5.59:1. Dark keeps its measured /70 (8.41:1).
  it("group labels are /80 in light and keep /70 in dark (contrast >= 4.5:1)", () => {
    render(
      <SidebarProvider>
        <SidebarGroupLabel>Taller</SidebarGroupLabel>
      </SidebarProvider>,
    );

    const label = screen.getByText("Taller");
    expect(label).toHaveClass("text-sidebar-foreground/80", "dark:text-sidebar-foreground/70");
    expect(label).not.toHaveClass("text-sidebar-foreground/70");
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

/** sidebar-redesign WU1 (D1): the inset variant is a floating, rounded, bordered panel. */
describe("Sidebar — inset panel (sidebar-redesign D1)", () => {
  it("the inner panel carries the radius, border and shadow under the inset variant", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar variant="inset">
          <p>nav</p>
        </Sidebar>
      </SidebarProvider>,
    );

    const inner = container.querySelector('[data-slot="sidebar-inner"]');
    expect(inner).toHaveClass(
      "group-data-[variant=inset]:rounded-2xl",
      "group-data-[variant=inset]:border",
      "group-data-[variant=inset]:border-sidebar-border",
      "group-data-[variant=inset]:shadow-sm",
    );
  });
});

describe("SidebarInset — inset radius (sidebar-redesign D1)", () => {
  // The more specific peer-data rule would beat a layout-level `lg:rounded-2xl`, so the primitive owns 16px.
  it("rounds the content panel at 16px under the inset variant", () => {
    render(
      <SidebarProvider>
        <SidebarInset>y</SidebarInset>
      </SidebarProvider>,
    );

    const cls = screen.getByText("y").className;
    expect(cls).toContain("lg:peer-data-[variant=inset]:rounded-2xl");
    expect(cls).not.toContain("rounded-xl");
  });
});

/** sidebar-redesign WU1 (D2): the sheet's own 44x44 Spanish close button. */
describe("Sidebar — mobile sheet close (sidebar-redesign D2)", () => {
  const original = window.innerWidth;
  afterEach(() => {
    window.innerWidth = original;
  });

  async function openSheet() {
    window.innerWidth = 800; // useIsMobile reads innerWidth, not matchMedia().matches
    const user = userEvent.setup();
    render(
      <SidebarProvider>
        <SidebarTrigger aria-label="Abrir menú" />
        <Sidebar>
          <p>nav</p>
        </Sidebar>
      </SidebarProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    return user;
  }

  it("offers one 'Cerrar menú' button with the 44x44 floor, and no English close", async () => {
    await openSheet();

    const close = await screen.findByRole("button", { name: "Cerrar menú" });
    // z-10: the header content follows it in the DOM and otherwise swallows the tap (seen at the LAN IP, not in jsdom).
    expect(close).toHaveClass("min-h-11", "min-w-11", "z-10");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes the sheet when activated", async () => {
    const user = await openSheet();

    await user.click(await screen.findByRole("button", { name: "Cerrar menú" }));
    await waitFor(() => expect(screen.queryByText("nav")).toBeNull());
  });

  it("names the dialog in Spanish", async () => {
    await openSheet();

    expect(await screen.findByRole("dialog", { name: "Menú" })).toHaveAccessibleDescription("Navegación principal");
    expect(screen.queryByText("Sidebar")).toBeNull();
  });
});
