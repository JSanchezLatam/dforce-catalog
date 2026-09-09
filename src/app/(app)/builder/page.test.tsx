/**
 * D10 point 1 — `/builder?products=…` is the receiving half of the inventory
 * handoff. The page's whole job here is to turn that query string into the
 * `seedProductIds` prop, capped, so this file mounts the page with the form
 * stubbed and reads the props it was handed.
 *
 * The cap matters more than it looks: `InventoryCatalogHandoff` refuses an
 * over-cap selection in the BROWSER, and a hand-edited URL never goes near
 * that check.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_TOTAL_PRODUCTS } from "@/modules/catalog-builder/selection";

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
const formProps = vi.hoisted(() => vi.fn());

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "administrador" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can }));
vi.mock("@/modules/catalog-builder/queries", () => ({ listCategoryPairs: vi.fn(async () => []) }));
vi.mock("@/modules/inventory-view/queries", () => ({ listCategoryL1Options: vi.fn(async () => []) }));
vi.mock("@/modules/catalog-storage/queries", () => ({ countUploadedCatalogsForUser: vi.fn(async () => 0) }));
vi.mock("@/modules/template-config/service", () => ({ getTemplateConfig: vi.fn(async () => null) }));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig: vi.fn(async () => null) }));
vi.mock("@/modules/catalog-builder/CatalogBuilderForm", () => ({
  CatalogBuilderForm: (props: Record<string, unknown>) => {
    formProps(props);
    return null;
  },
}));

import CatalogBuilderPage from "./page";

async function seedsFor(params: Record<string, string | string[]>): Promise<unknown> {
  render(await CatalogBuilderPage({ searchParams: Promise.resolve(params) }));
  return formProps.mock.calls.at(-1)?.[0].seedProductIds;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CatalogBuilderPage — the inventory handoff (D10)", () => {
  it("hands the form the ids from ?products=", async () => {
    expect(await seedsFor({ products: "PS1,PS2,PS3" })).toEqual(["PS1", "PS2", "PS3"]);
  });

  it("hands it an empty list when nobody came from /inventory", async () => {
    expect(await seedsFor({})).toEqual([]);
  });

  /**
   * The expectation is the INPUT's own prefix rather than a length phrased in
   * terms of the cap, so widening or removing the cap changes the result and
   * turns this red instead of following the constant it is meant to pin.
   */
  it("caps a hand-edited over-cap URL server-side", async () => {
    const ids = Array.from({ length: MAX_TOTAL_PRODUCTS + 50 }, (_, i) => `PS${i}`);

    expect(await seedsFor({ products: ids.join(",") })).toEqual(ids.slice(0, MAX_TOTAL_PRODUCTS));
  });

  it("still refuses the page to a user without catalogs.generate", async () => {
    can.mockReturnValueOnce(false);
    render(await CatalogBuilderPage({ searchParams: Promise.resolve({ products: "PS1" }) }));

    expect(formProps).not.toHaveBeenCalled();
  });
});
