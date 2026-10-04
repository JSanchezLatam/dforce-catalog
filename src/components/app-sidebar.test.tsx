/**
 * Component tests for the collapsible sidebar (PR #13, shipped previously
 * with zero rendering coverage — see AGENTS.md's Testing section for the
 * jsdom/`*.test.tsx` convention this file follows).
 *
 * `next/navigation`'s `usePathname` is mocked because `NavLinkItem` calls it
 * unconditionally to compute the active-link style; this component tree
 * never opens the footer user-menu dropdown in these tests, so
 * `next-themes`/`next/navigation`'s `useRouter` (used lazily by
 * `ThemeToggle`/`LogoutButton` only once that dropdown's content mounts)
 * never need mocking here.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DEFAULT_NAV_COLLAPSE_STATE, type NavCollapseState } from "@/modules/layout/nav-collapse-state";
import type { NavGroup } from "@/modules/layout/nav-items";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
}));

const NAV_GROUPS: NavGroup[] = [
  {
    id: "crm",
    label: "CRM",
    items: [{ kind: "link", href: "/customers", label: "Clientes", icon: "customers" }],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    items: [{ kind: "link", href: "/builder", label: "Generar Catálogos", icon: "builder" }],
  },
  {
    id: "configuracion",
    label: "Configuración",
    pinBottom: true,
    items: [
      { kind: "link", href: "/workshop-config", label: "Config. del CRM", icon: "template-config" },
      {
        kind: "parent",
        id: "config-catalogos",
        label: "Config. de catálogos",
        icon: "template-config",
        children: [{ kind: "link", href: "/template-config", label: "Configuración de plantillas", icon: "template-config" }],
      },
    ],
  },
];

function renderSidebar(initialCollapseState: NavCollapseState = DEFAULT_NAV_COLLAPSE_STATE) {
  return render(
    <SidebarProvider>
      <AppSidebar
        navGroups={NAV_GROUPS}
        user={{ id: "u1", role: "admin", name: "Jorge" }}
        workshopName="Taller Demo"
        logoR2Key={null}
        initialCollapseState={initialCollapseState}
      />
    </SidebarProvider>
  );
}

describe("AppSidebar — collapsible nav groups", () => {
  it("renders the group trigger as a real button with aria-expanded that flips on toggle", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const trigger = screen.getByRole("button", { name: "CRM" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses a group's items out of the accessible tree, then restores them", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole("link", { name: "Clientes" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CRM" }));
    expect(screen.queryByRole("link", { name: "Clientes" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CRM" }));
    expect(screen.getByRole("link", { name: "Clientes" })).toBeInTheDocument();
  });

  it("keeps groups independent — collapsing CRM does not collapse Catálogo", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "CRM" }));

    expect(screen.queryByRole("link", { name: "Clientes" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Generar Catálogos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catálogo" })).toHaveAttribute("aria-expanded", "true");
  });

  it("operates the trigger via keyboard Enter and Space", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const trigger = screen.getByRole("button", { name: "CRM" });
    trigger.focus();

    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("points aria-controls at the panel that actually exists in the DOM", () => {
    renderSidebar();

    const trigger = screen.getByRole("button", { name: "CRM" });
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).not.toBeNull();
  });

  it("collapses the nested 'Config. de catálogos' parent independently of its own group", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const parentTrigger = screen.getByRole("button", { name: "Config. de catálogos" });
    expect(parentTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Configuración de plantillas" })).toBeInTheDocument();

    await user.click(parentTrigger);

    expect(parentTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Configuración de plantillas" })).not.toBeInTheDocument();
    // The parent's own group ("Configuración") must stay open — its sibling
    // link must still be present.
    expect(screen.getByRole("link", { name: "Config. del CRM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración" })).toHaveAttribute("aria-expanded", "true");
  });

  it("respects initialCollapseState from the server on first render — no expanded-then-collapse flip", () => {
    renderSidebar({ ...DEFAULT_NAV_COLLAPSE_STATE, crm: false });

    // Asserted immediately after render(), with no waitFor/act flush in
    // between — if the component ever opened first and closed afterward,
    // this synchronous check would catch the open state.
    expect(screen.getByRole("button", { name: "CRM" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Clientes" })).not.toBeInTheDocument();
  });

  it("exposes group semantics: role=group and aria-labelledby resolving to the visible label", () => {
    renderSidebar();

    const crmGroup = screen.getByRole("group", { name: "CRM" });
    expect(within(crmGroup).getByRole("link", { name: "Clientes" })).toBeInTheDocument();

    const catalogoGroup = screen.getByRole("group", { name: "Catálogo" });
    expect(within(catalogoGroup).getByRole("link", { name: "Generar Catálogos" })).toBeInTheDocument();
  });
});

/**
 * The Vencimientos badge. `SidebarMenuBadge` is `group-data-[collapsible=icon]:hidden`,
 * so in the collapsed rail the count would vanish: the link carries an
 * aria-hidden dot and the tooltip names the count instead.
 */
describe("AppSidebar — Vencimientos badge", () => {
  function groupsWith(badge?: number): NavGroup[] {
    return [
      {
        id: "crm",
        label: "CRM",
        items: [{ kind: "link", href: "/vencimientos", label: "Vencimientos", icon: "vencimientos", ...(badge ? { badge } : {}) }],
      },
    ];
  }

  function renderWith(badge: number | undefined, open = true) {
    return render(
      <SidebarProvider defaultOpen={open}>
        <AppSidebar
          navGroups={groupsWith(badge)}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );
  }

  it("shows the count visibly and gives the link an sr-only count", () => {
    renderWith(5);

    expect(screen.getByRole("link", { name: "Vencimientos, 5 próximos" })).toBeInTheDocument();
    // Beside the link, and aria-hidden: the sr-only text inside it already says it.
    expect(screen.getByText("5")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows nothing but the label when there is no badge", () => {
    renderWith(undefined);

    expect(screen.getByRole("link", { name: "Vencimientos" })).toBeInTheDocument();
    expect(screen.queryByTestId("vencimientos-dot")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("in the collapsed rail keeps an aria-hidden dot and names the count in the tooltip", async () => {
    const user = userEvent.setup();
    renderWith(5, false);

    expect(screen.getByTestId("vencimientos-dot")).toHaveAttribute("aria-hidden", "true");
    await user.hover(screen.getByRole("link", { name: "Vencimientos, 5 próximos" }));
    expect(await screen.findByText("Vencimientos próximos (5)")).toBeInTheDocument();
  });
});
