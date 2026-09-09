/**
 * The candidate-product lookup behind BOTH of the builder's selection modes
 * (design D10 point 1): the category tree it has always served, and the
 * product-id list `/inventory` hands over. One route, one `catalogs.read`
 * gate, no new permission surface — `route-guards.test.ts` cross-references
 * that declaration against this file's source.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductRef } from "@/modules/catalog-builder/selection";

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
const listProductsInCategories = vi.hoisted(() => vi.fn(async () => [] as ProductRef[]));
const listProductsByIds = vi.hoisted(() => vi.fn(async () => [] as ProductRef[]));

vi.mock("@/modules/auth/policy", () => ({ can }));
vi.mock("@/modules/catalog-builder/queries", () => ({ listProductsInCategories, listProductsByIds }));

import { POST } from "./route";

function productsRequest(body: unknown) {
  return new NextRequest("http://localhost/api/catalog-builder/products", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-user-id": "user-1", "x-user-role": "administrador", "content-type": "application/json" },
  });
}

const ROWS: ProductRef[] = [
  { id: "PS1", name: "Filtro", categoryL1: "REPUESTOS", categoryL2: null },
  { id: "PS3", name: "Correa", categoryL1: "REPUESTOS", categoryL2: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  can.mockReturnValue(true);
  listProductsInCategories.mockResolvedValue([]);
  listProductsByIds.mockResolvedValue([]);
});

describe("POST — product-id mode (D10)", () => {
  it("resolves the handed-over ids and answers with what the database still has", async () => {
    listProductsByIds.mockResolvedValue(ROWS);

    const response = await POST(productsRequest({ productIds: ["PS1", "PS2", "PS3"] }));

    expect(listProductsByIds).toHaveBeenCalledWith(["PS1", "PS2", "PS3"]);
    // Two rows for three requested ids: the stale one is simply absent, never
    // padded out into a nameless placeholder card.
    await expect(response.json()).resolves.toEqual({ products: ROWS });
  });

  /**
   * The ids arrive from a URL, so the body is attacker-shaped by default.
   * Anything that is not a string would reach `inArray` and become a
   * malformed query rather than a 200 with fewer rows.
   */
  it("drops non-string entries instead of handing them to the query", async () => {
    await POST(productsRequest({ productIds: ["PS1", 7, null, { id: "PS2" }, "PS3"] }));

    expect(listProductsByIds).toHaveBeenCalledWith(["PS1", "PS3"]);
  });

  it("asks for nothing when the id list is empty or malformed", async () => {
    for (const body of [{ productIds: [] }, { productIds: "PS1" }, {}, null]) {
      const response = await POST(productsRequest(body));
      await expect(response.json()).resolves.toEqual({ products: [] });
    }

    expect(listProductsByIds).not.toHaveBeenCalled();
    expect(listProductsInCategories).not.toHaveBeenCalled();
  });
});

describe("POST — category mode is unchanged (7b.7)", () => {
  it("still resolves a categories body through listProductsInCategories", async () => {
    listProductsInCategories.mockResolvedValue(ROWS);

    const response = await POST(productsRequest({ categories: [{ categoryL1: "REPUESTOS" }] }));

    expect(listProductsInCategories).toHaveBeenCalledWith([{ categoryL1: "REPUESTOS" }]);
    expect(listProductsByIds).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ products: ROWS });
  });

  it("still drops category refs that are not shaped like one", async () => {
    await POST(productsRequest({ categories: [{ categoryL1: "REPUESTOS" }, "MOTOR", { categoryL2: "FILTROS" }] }));

    expect(listProductsInCategories).toHaveBeenCalledWith([{ categoryL1: "REPUESTOS" }]);
  });
});

describe("POST — the catalogs.read gate covers both modes", () => {
  it.each([
    ["productIds", { productIds: ["PS1"] }],
    ["categories", { categories: [{ categoryL1: "REPUESTOS" }] }],
  ])("refuses a %s body without catalogs.read, before reading anything", async (_mode, body) => {
    can.mockReturnValue(false);

    const response = await POST(productsRequest(body));

    expect(response.status).toBe(403);
    expect(listProductsByIds).not.toHaveBeenCalled();
    expect(listProductsInCategories).not.toHaveBeenCalled();
  });

  it("checks catalogs.read and no other action", async () => {
    await POST(productsRequest({ productIds: ["PS1"] }));

    expect(can.mock.calls.map(([, action]) => action)).toEqual(["catalogs.read"]);
  });
});
