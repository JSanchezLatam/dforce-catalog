/**
 * Component tests for the collapsible sidebar (PR #13, shipped previously
 * with zero rendering coverage — see AGENTS.md's Testing section for the
 * jsdom/`*.test.tsx` convention this file follows).
 *
 * `next/navigation`'s `usePathname` is mocked because `NavLinkItem` calls it
 * unconditionally to compute the active-link style. `useRouter` and
 * `next-themes` are mocked only because opening the footer user menu mounts
 * `LogoutButton` and `ThemeToggle`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DEFAULT_NAV_COLLAPSE_STATE, type NavCollapseState } from "@/modules/layout/nav-collapse-state";
import type { NavGroup } from "@/modules/layout/nav-items";

const nav = vi.hoisted(() => ({ pathname: "/inventory" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  // LogoutButton calls it as soon as the user menu opens.
  useRouter: () => ({ push: vi.fn() }),
}));
// ThemeToggle renders nothing until next-themes has resolved a theme; there is no provider here.
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
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

describe("AppSidebar — Tablero icon", () => {
  it("renders the `board` key as LayoutDashboard, not the Package fallback", () => {
    render(
      <SidebarProvider defaultOpen>
        <AppSidebar
          navGroups={[{ id: "crm", label: "CRM", items: [{ kind: "link", href: "/tablero", label: "Tablero", icon: "board" }] }]}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );

    const svg = screen.getByRole("link", { name: "Tablero" }).querySelector("svg");
    expect(svg).toHaveClass("lucide-layout-dashboard");
  });
});

describe("AppSidebar — Agenda icon", () => {
  it("renders the `agenda` key as CalendarDays, not the Package fallback", () => {
    render(
      <SidebarProvider defaultOpen>
        <AppSidebar
          navGroups={[{ id: "crm", label: "CRM", items: [{ kind: "link", href: "/agenda", label: "Agenda", icon: "agenda" }] }]}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );

    const svg = screen.getByRole("link", { name: "Agenda" }).querySelector("svg");
    expect(svg).toHaveClass("lucide-calendar-days");
  });
});

/**
 * /tablero is a prefix of /tablero/clientes, so a bare `startsWith` marked BOTH
 * screens current on the customer screen. Only the longest matching sibling is.
 */
describe("AppSidebar — Tablero parent", () => {
  const TABLERO: NavGroup[] = [
    {
      id: "taller",
      label: "Taller",
      items: [
        {
          kind: "parent",
          id: "tablero",
          label: "Tablero",
          icon: "board",
          children: [
            { kind: "link", href: "/kanban", label: "Órdenes en curso", icon: "kanban", action: "board.read" },
            { kind: "link", href: "/tablero", label: "Pantalla del taller", icon: "board", action: "board.read" },
            { kind: "link", href: "/tablero/clientes", label: "Pantalla de clientes", icon: "board", action: "board.customer" },
          ],
        },
      ],
    },
  ];

  afterEach(() => {
    nav.pathname = "/inventory";
  });

  async function boldChildren(pathname: string) {
    nav.pathname = pathname;
    const user = userEvent.setup();
    render(
      <SidebarProvider defaultOpen={false}>
        <AppSidebar
          navGroups={TABLERO}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tablero" }));
    const links = await screen.findAllByRole("link", { name: /^(Órdenes en curso|Pantalla del taller|Pantalla de clientes)$/ });
    return links.filter((l) => l.classList.contains("font-semibold")).map((l) => l.textContent);
  }

  it("on /tablero/clientes marks only Pantalla de clientes", async () => {
    expect(await boldChildren("/tablero/clientes")).toEqual(["Pantalla de clientes"]);
  });

  it("on /tablero marks only Pantalla del taller", async () => {
    expect(await boldChildren("/tablero")).toEqual(["Pantalla del taller"]);
  });

  // getGroupOpen answers "open" for any id outside NAV_COLLAPSE_KEYS, so an unlisted parent could never close.
  it("in the expanded sidebar the Tablero parent collapses its three children", async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider defaultOpen>
        <AppSidebar
          navGroups={TABLERO}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );
    expect(screen.getByRole("link", { name: "Pantalla de clientes" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tablero" }));

    expect(screen.getByRole("button", { name: "Tablero" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Pantalla de clientes" })).not.toBeInTheDocument();
  });
});

/** sidebar-redesign WU2 (D3-D5). jsdom sees classes, not hover, sizes or paint: those are browser checks. */
describe("AppSidebar — nav restyle (sidebar-redesign WU2)", () => {
  const TABLERO: NavGroup[] = [
    {
      id: "taller",
      label: "Taller",
      items: [
        {
          kind: "parent",
          id: "tablero",
          label: "Tablero",
          icon: "board",
          children: [
            { kind: "link", href: "/kanban", label: "Órdenes en curso", icon: "kanban", action: "board.read" },
            { kind: "link", href: "/tablero", label: "Pantalla del taller", icon: "board", action: "board.read" },
            { kind: "link", href: "/tablero/clientes", label: "Pantalla de clientes", icon: "board", action: "board.customer" },
          ],
        },
      ],
    },
  ];

  afterEach(() => {
    nav.pathname = "/inventory";
    window.innerWidth = 1024;
  });

  function renderNav(groups: NavGroup[], opts: { open?: boolean; state?: NavCollapseState } = {}) {
    return render(
      <SidebarProvider defaultOpen={opts.open ?? true}>
        <AppSidebar
          navGroups={groups}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={opts.state ?? DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );
  }

  it("expanded on /tablero/clientes marks only Pantalla de clientes as the current page", () => {
    nav.pathname = "/tablero/clientes";
    renderNav(TABLERO);

    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Pantalla de clientes"]);
  });

  it("a top-level link on its own page carries aria-current, and only that one", () => {
    nav.pathname = "/customers";
    renderNav(NAV_GROUPS);

    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Generar Catálogos" })).not.toHaveAttribute("aria-current");
  });

  it("in the rail on /kanban the Tablero button is active", () => {
    nav.pathname = "/kanban";
    renderNav(TABLERO, { open: false });

    expect(screen.getByRole("button", { name: "Tablero" })).toHaveAttribute("data-active");
  });

  it("renders no separator", () => {
    renderNav(NAV_GROUPS);

    expect(document.querySelector('[data-sidebar="separator"]')).toBeNull();
  });

  it("hides an open group's chevron until hover or focus, but never on touch", () => {
    renderNav(NAV_GROUPS);

    const chevron = screen.getByRole("button", { name: "CRM" }).querySelector("svg");
    expect(chevron).toHaveClass(
      "opacity-0",
      "group-hover/label:opacity-100",
      "group-focus-visible/label:opacity-100",
      "pointer-coarse:opacity-100",
    );
  });

  it("keeps a closed group's chevron visible", () => {
    renderNav(NAV_GROUPS, { state: { ...DEFAULT_NAV_COLLAPSE_STATE, crm: false } });

    const chevron = screen.getByRole("button", { name: "CRM" }).querySelector("svg");
    expect(chevron).not.toHaveClass("opacity-0");
  });

  it("paints group labels muted", () => {
    renderNav(NAV_GROUPS);

    // dark: too, or the primitive's dark:text-sidebar-foreground/70 wins in dark mode.
    expect(screen.getByRole("button", { name: "CRM" })).toHaveClass("text-muted-foreground", "dark:text-muted-foreground");
  });

  it("draws the user card with a border", () => {
    renderNav(NAV_GROUPS);

    expect(screen.getByRole("button", { name: /Jorge/ })).toHaveClass("rounded-xl", "border", "border-sidebar-border");
  });

  it("opens the user menu with Mi cuenta, the theme item and Cerrar sesión, in that order", async () => {
    const user = userEvent.setup();
    renderNav(NAV_GROUPS);

    await user.click(screen.getByRole("button", { name: /Jorge/ }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Mi cuenta", "Modo oscuro", "Cerrar sesión"]);
  });

  // The sheet's absolute 44px close button sits over the header's top-right corner.
  it("reserves room for the sheet's close button in the header, only inside the mobile sheet", async () => {
    window.innerWidth = 800; // useIsMobile reads innerWidth
    const user = userEvent.setup();
    render(
      <SidebarProvider>
        <SidebarTrigger aria-label="Abrir menú" />
        <AppSidebar
          navGroups={NAV_GROUPS}
          user={{ id: "u1", role: "administrador", name: "Jorge" }}
          workshopName="Taller Demo"
          logoR2Key={null}
          initialCollapseState={DEFAULT_NAV_COLLAPSE_STATE}
        />
      </SidebarProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));

    const header = await waitFor(() => {
      const el = document.querySelector('[data-sidebar="header"]');
      if (!el) throw new Error("sheet not open");
      return el;
    });
    expect(header.closest('[data-mobile="true"]')).not.toBeNull();
    expect(header).toHaveClass("in-data-[mobile=true]:pr-13");
  });
});
