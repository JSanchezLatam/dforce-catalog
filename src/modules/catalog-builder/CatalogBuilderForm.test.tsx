/**
 * Component tests for the review step's price shape (catalog-templates-and-
 * workshop-info WU4, task 4.11 — R13). No file existed before this unit.
 *
 * Only the review-step price behavior is covered here — the rest of this
 * large form (search, pagination, layout tuner, eviction warning) is out of
 * this WU's scope and already exercised end-to-end by `full-flow.e2e.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CatalogBuilderForm } from "./CatalogBuilderForm";

const CANDIDATE = {
  id: "p1",
  name: "Woofer",
  categoryL1: "Motor",
  categoryL2: null,
  image: null,
  imageType: null,
  // A hostile/real "0.00" socio tier — resolveAllPrices must null it, not send 0.
  priceLists: { "Precio de venta": "45.00", "PRECIO TALLER": "38.00", "Precio Socio": "0.00" },
};

function mockFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/products")) {
      return Promise.resolve({ ok: true, json: async () => ({ products: [CANDIDATE] }) });
    }
    if (url.includes("/queue-depth")) {
      return Promise.resolve({ ok: true, json: async () => ({ depth: 0 }) });
    }
    if (url.includes("/generate")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-1", queuePosition: 0, evictionWarning: false }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function reachReviewStep() {
  const fetchMock = mockFetch();
  const user = userEvent.setup();
  render(
    <CatalogBuilderForm
      categoryL1Options={["Motor"]}
      categoryPairs={[]}
      templateConfig={null}
      workshopConfig={null}
      catalogCount={0}
    />,
  );

  await user.click(screen.getByRole("button", { name: /Seleccion.* categor.as/ }));
  await user.click(await screen.findByRole("checkbox", { name: "Motor" }));
  await screen.findByText("Woofer");
  await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
  return { fetchMock, user };
}

describe("CatalogBuilderForm — review step no longer offers a tier selector (R13)", () => {
  it("does not render a 'Lista de precios' control", async () => {
    await reachReviewStep();

    expect(screen.queryByText("Lista de precios")).not.toBeInTheDocument();
  });
});

describe("CatalogBuilderForm — reviewedProducts carries all three tiers (design D4)", () => {
  it("POSTs prices: resolveAllPrices(priceLists) per product, not a single collapsed price", async () => {
    const { fetchMock, user } = await reachReviewStep();

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/catalog-builder/generate", expect.anything()),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/catalog-builder/generate")!;
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.products[0].prices).toEqual({ venta: 45, taller: 38, socio: null });
    expect(body.products[0].price).toBeUndefined();
    expect(body.products[0].priceLists).toBeUndefined();
  });
});
