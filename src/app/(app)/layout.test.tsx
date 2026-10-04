/**
 * Wiring only: the layout must feed `getNavBadges`' result to `getNavGroups`.
 * `getNavGroups` and the policy are real; the sidebar is a probe that prints
 * the groups it was handed.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ current: { id: "u1", role: "administrador" } }));
vi.mock("@/modules/auth/session", () => ({ requireSessionFromHeaders: vi.fn(async () => user.current) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/modules/account/queries", () => ({ getUserProfile: async () => null }));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig: async () => null }));
const getNavBadges = vi.hoisted(() => vi.fn());
vi.mock("@/modules/layout/nav-badges", () => ({ getNavBadges }));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: ({ navGroups }: { navGroups: unknown }) => <pre data-testid="groups">{JSON.stringify(navGroups)}</pre>,
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
