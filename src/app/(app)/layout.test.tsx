/**
 * Wiring only: the layout must feed `getNavBadges`' result to `getNavGroups`.
 * `getNavGroups` and the policy are real; the sidebar is a probe that prints
 * the groups it was handed.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ current: { id: "u1", role: "administrador" } }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => user.current) }));
const redirect = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/modules/account/queries", () => ({ getUserProfile: async () => null }));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig: async () => null }));
const getNavBadges = vi.hoisted(() => vi.fn());
vi.mock("@/modules/layout/nav-badges", () => ({ getNavBadges }));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: ({ navGroups }: { navGroups: unknown }) => <pre data-testid="groups">{JSON.stringify(navGroups)}</pre>,
}));

// A probe: the real provider mounts the dialog, which needs a router and a toast tree this wiring test does not build.
vi.mock("@/modules/feedback/FeedbackProvider", () => ({
  FeedbackProvider: ({ author, children }: { author: unknown; children: React.ReactNode }) => (
    <div data-testid="feedback-provider" data-author={JSON.stringify(author)}>
      {children}
    </div>
  ),
}));

// A probe: the real counter calls `usePathname`, which this mock of next/navigation does not provide.
vi.mock("@/modules/usage/UsageCounter", () => ({
  UsageCounter: (props: Record<string, unknown>) => <span data-testid="usage-counter" data-props={JSON.stringify(props)} />,
}));

import AppLayout from "./layout";

async function renderedLinks() {
  render(await AppLayout({ children: null }));
  const groups = JSON.parse(screen.getByTestId("groups").textContent ?? "[]") as { items: { href: string; badge?: number }[] }[];
  return groups.flatMap((g) => g.items);
}

beforeEach(() => {
  user.current = { id: "u1", role: "administrador" };
  getNavBadges.mockReset();
});

describe("(app)/layout — sidebar badge wiring", () => {
  it("puts the count from getNavBadges on the Vencimientos link", async () => {
    getNavBadges.mockResolvedValue({ "/vencimientos": 4 });

    const links = await renderedLinks();

    expect(links.find((l) => l.href === "/vencimientos")?.badge).toBe(4);
    expect(getNavBadges).toHaveBeenCalledWith(user.current);
  });

  it("leaves the link without a badge at zero", async () => {
    getNavBadges.mockResolvedValue({ "/vencimientos": 0 });

    const link = (await renderedLinks()).find((l) => l.href === "/vencimientos");

    expect(link).toBeDefined();
    expect(link).not.toHaveProperty("badge");
  });
});

describe("(app)/layout — mobile navigation", () => {
  // Below `lg` the sidebar is an off-canvas Sheet; without this trigger a phone
  // has no way to open the navigation at all.
  it("renders an 'Abrir menú' trigger so a phone can open the sidebar", async () => {
    getNavBadges.mockResolvedValue({});

    render(await AppLayout({ children: null }));

    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
  });

  // The bar must be visible exactly while the sidebar is off-canvas (< lg).
  it("shows the top bar until lg, matching the sidebar breakpoint", async () => {
    getNavBadges.mockResolvedValue({});

    render(await AppLayout({ children: null }));

    const header = screen.getByRole("button", { name: "Abrir menú" }).closest("header");
    expect(header).toHaveClass("lg:hidden");
    expect(header).not.toHaveClass("md:hidden");
  });
});

describe("(app)/layout - pantalla never sees the application shell", () => {
  it("redirects a pantalla session to its landing before the shell, the badges or the profile are loaded", async () => {
    user.current = { id: "u2", role: "pantalla" };

    await expect(AppLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/tablero/clientes");

    expect(redirect).toHaveBeenCalledWith("/tablero/clientes");
    expect(getNavBadges).not.toHaveBeenCalled();
  });

  it("does not redirect an administrador", async () => {
    getNavBadges.mockResolvedValue({});
    redirect.mockClear();

    render(await AppLayout({ children: null }));

    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("(app)/layout - feedback provider", () => {
  // A Server Component can only hand a client one plain strings: the author, never a function.
  it("hands the provider the author as plain strings and wraps the sidebar", async () => {
    getNavBadges.mockResolvedValue({});
    user.current = { id: "u1", role: "tecnico" };

    render(await AppLayout({ children: null }));

    const provider = screen.getByTestId("feedback-provider");
    expect(JSON.parse(provider.dataset.author ?? "null")).toEqual({ username: "usuario", roleLabel: "Técnico" });
    expect(provider).toContainElement(screen.getByTestId("groups"));
  });
});

describe("(app)/layout - usage counter", () => {
  // Mounted once in the shell; a Server Component may pass it no function prop, so it gets none at all.
  it("mounts the usage counter inside the feedback provider with no props", async () => {
    getNavBadges.mockResolvedValue({});

    render(await AppLayout({ children: null }));

    const counter = screen.getByTestId("usage-counter");
    expect(counter.dataset.props).toBe("{}");
    expect(screen.getByTestId("feedback-provider")).toContainElement(counter);
  });
});
