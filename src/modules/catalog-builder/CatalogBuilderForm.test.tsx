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

function mockFetch(generateResponse?: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/products")) {
      return Promise.resolve({ ok: true, json: async () => ({ products: [CANDIDATE] }) });
    }
    if (url.includes("/queue-depth")) {
      return Promise.resolve({ ok: true, json: async () => ({ depth: 0 }) });
    }
    if (url.includes("/generate")) {
      return Promise.resolve(
        generateResponse ?? {
          ok: true,
          status: 200,
          json: async () => ({ jobId: "job-1", queuePosition: 0, evictionWarning: false }),
        },
      );
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

async function reachReviewStep(generateResponse?: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}) {
  const fetchMock = mockFetch(generateResponse);
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
  // The select-step "Continue" button and the review-step "open confirm
  // dialog" button share this exact label but are mutually exclusive by
  // `step` — only one is ever mounted, so `getByRole` (which throws on a
  // multi-match) stays the guard if that conditional rendering ever changes.
  await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
  return { fetchMock, user };
}

/**
 * R13, superseded. The review step DOES offer a price-list choice again — but
 * as a checkbox group picking one or two of the three tiers, not the old
 * single-select that collapsed the payload to one list before generation. The
 * distinction that matters and that the previous spec lost: all three tiers
 * still TRAVEL to the worker; this only chooses which ones PRINT.
 */
describe("CatalogBuilderForm — review step picks which price lists print (R13)", () => {
  const box = (label: string) => screen.getByRole("checkbox", { name: label });
  /**
   * Base UI's Checkbox is a `<span role="checkbox">`, not an `<input>`, so it
   * marks refusal with `aria-disabled` — which is what assistive tech reads
   * and what jest-dom's `toBeDisabled()` (native `disabled` only) does not
   * see. Asserting the attribute is asserting the real contract.
   */
  const isBlocked = (label: string) => box(label).getAttribute("aria-disabled") === "true";

  it("offers the three ERP lists, with Venta and Taller pre-chosen", async () => {
    await reachReviewStep();

    expect(box("Venta")).toBeChecked();
    expect(box("Taller")).toBeChecked();
    expect(box("Socio")).not.toBeChecked();
  });

  it("blocks a third choice instead of failing on submit", async () => {
    const { user } = await reachReviewStep();

    // Two are already ticked, so the third must be unreachable — an error
    // shown after the fact would be a worse answer than a control that
    // cannot express the invalid state.
    expect(isBlocked("Socio")).toBe(true);

    await user.click(box("Taller"));
    expect(isBlocked("Socio")).toBe(false);
  });

  it("blocks unticking the last one — a card with no price row is not a catalog", async () => {
    const { user } = await reachReviewStep();

    await user.click(box("Taller"));
    expect(isBlocked("Venta")).toBe(true);
  });

  /**
   * The preview sits directly under the checkbox group — the one screen where
   * the choice and its consequence are visible at once. Its index page carries
   * the same footer the PDF does (the preview renders no product cards, which
   * is why the footer is the ONLY place the choice shows there, and why
   * "the preview has no price rows" was the wrong reason to skip threading
   * `tiers` into it).
   */
  it("keeps the live preview's footer honest about the choice", async () => {
    const { user } = await reachReviewStep();

    expect(screen.getByText("Lista de precios · Venta · Taller")).toBeInTheDocument();

    await user.click(box("Taller"));

    expect(screen.getByText("Lista de precios · Venta")).toBeInTheDocument();
    expect(screen.queryByText("Lista de precios · Venta · Taller")).not.toBeInTheDocument();
  });

  it("POSTs the chosen tiers, and still sends every tier's VALUE", async () => {
    const { fetchMock, user } = await reachReviewStep();

    await user.click(box("Taller"));
    await user.click(box("Socio"));

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/catalog-builder/generate", expect.anything()),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/catalog-builder/generate")!;
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.tiers).toEqual(["venta", "socio"]);
    // The choice is a RENDER instruction. Stripping the unprinted tiers from
    // the payload would mean re-reading the ERP to reprint the same catalog
    // with a different pair.
    expect(body.products[0].prices).toEqual({ venta: 45, taller: 38, socio: null });
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

/**
 * The checkbox group cannot produce an invalid selection, so this 400 only
 * ever comes from a non-UI client or a drifted client/server rule. Either way
 * the message must land on screen: an error set into state and rendered
 * nowhere is a dead Generar button with no explanation, which is strictly
 * worse than the validation not existing.
 */
describe("CatalogBuilderForm — a tiers error from the route is shown", () => {
  it("renders errors.tiers instead of leaving the dialog silently stuck", async () => {
    const { user } = await reachReviewStep({
      ok: false,
      status: 400,
      json: async () => ({ errors: { tiers: "Elegí 1 o 2 listas de precios" } }),
    });

    await user.click(screen.getByRole("button", { name: "Empezar a generar" }));
    await user.click(await screen.findByRole("button", { name: "Generar catálogo" }));

    expect(await screen.findByText("Elegí 1 o 2 listas de precios")).toBeInTheDocument();
  });
});
